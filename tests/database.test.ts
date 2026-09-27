import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

// The framework's server-only marker is enforced by Next's bundler. These tests
// run server services directly in Node, never in a browser.
const require = createRequire(import.meta.url);
require.cache[require.resolve("server-only")] = { exports: {} } as NodeModule;

test("isolated PostgreSQL service regressions (never loads .env)", { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "ledger-tests-"));
  const socket = createServer();
  await new Promise<void>(r => socket.listen(0, "127.0.0.1", r));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(r => socket.close(() => r()));
  const postgres = new EmbeddedPostgres({ databaseDir: directory, user: "tests", password: "local-tests-only", port, persistent: true });
  let pool: { end(): Promise<void> } | undefined;
  const pgCtl = resolve("node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe");
  try {
    await postgres.initialise();
    if (process.platform === "win32") {
      execFileSync(pgCtl, ["start", "-D", directory, "-l", join(directory, "postgres.log"), "-o", "-p " + port, "-w"], { stdio: "ignore", windowsHide: true });
    } else await postgres.start();
    const bootstrap = postgres.getPgClient("postgres");
    await bootstrap.connect();
    await bootstrap.query("CREATE DATABASE ledger_test ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    await bootstrap.end();
    process.env.DATABASE_URL = `postgres://tests:local-tests-only@127.0.0.1:${port}/ledger_test`;
    const database = await import("../src/db");
    pool = database.pool;
    const query = (text: string, values?: unknown[]) => database.pool.query(text, values);
    for (const name of (await readdir(resolve("src/db/migrations"))).filter(n => n.endsWith(".sql")).sort()) {
      await query(await readFile(resolve("src/db/migrations", name), "utf8"));
    }
    const admin = randomUUID(), firm = randomUUID(), plan = randomUUID();
    await query("INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,'platform@test.invalid','unused','Test Admin','platform_admin')", [admin]);
    await query("INSERT INTO firms (id,name) VALUES ($1,'Test Firm')", [firm]);
    await query("INSERT INTO plans(id,code,name,max_entities,max_users) VALUES ($1,'TEST','Test',1,1)", [plan]);
    await query("INSERT INTO subscriptions(firm_id,plan_id,status,started_on) VALUES ($1,$2,'active',CURRENT_DATE)", [firm, plan]);
    const clients = await import("../src/services/firms");
    const users = await import("../src/services/users");
    const auth = await import("../src/lib/auth");
    const subscriptions = await import("../src/services/subscriptions");
    const security = await import("../src/lib/security");
    const authSecurity = await import("../src/services/auth-security");
    const recovery = await import("../src/services/password-recovery");
    const fixture = async (name: string, fiscalMonth = 1) => {
      const coa = await import("../src/services/coa");
      const id = randomUUID();
      await query("INSERT INTO entities(id,name,firm_id,fiscal_year_start_month) VALUES($1,$2,$3,$4)", [id,name,firm,fiscalMonth]);
      await coa.seedDefaultCoa(id);
      const accounts = (await query("SELECT id,account_number FROM chart_of_accounts WHERE entity_id=$1", [id])).rows;
      return { id, account: (number: string) => accounts.find(a => a.account_number === number).id as string };
    };
    await t.test("durable login throttling is atomic under concurrent requests and expires", async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => authSecurity.reserveAuthBucket("test-email", 8)));
      assert.equal(results.filter(Boolean).length, 8);
      await query("UPDATE auth_rate_limits SET window_started_at=now()-interval '16 minutes'");
      assert.equal(await authSecurity.reserveAuthBucket("test-email", 8), true);
    });
    await t.test("MFA rejects reused codes even across transactions", async () => {
      process.env.AUTH_ENCRYPTION_KEY = "ab".repeat(32);
      const secret = "JBSWY3DPEHPK3PXP";
      await query("INSERT INTO user_security(user_id,mfa_secret,mfa_enabled) VALUES($1,$2,true)", [admin, security.encryptSecret(secret)]);
      const code = security.authenticator(secret, "").generate();
      assert.equal(await database.db.transaction(tx => authSecurity.verifyMfa(tx, admin, code)), true);
      assert.equal(await database.db.transaction(tx => authSecurity.verifyMfa(tx, admin, code)), false);
    });
    await t.test("password reset is single-use, expires and revokes sessions", async () => {
      const token = "a".repeat(64);
      await query("INSERT INTO password_reset_tokens VALUES($1,$2,now()-interval '1 minute')", [security.tokenHash(token), admin]);
      assert.equal(await recovery.completePasswordReset(token, "new-hash", ""), false);
      await query("UPDATE password_reset_tokens SET expires_at=now()+interval '30 minutes'");
      // MFA cannot be bypassed by presenting a valid email-recovery link.
      assert.equal(await recovery.completePasswordReset(token, "new-hash", "bad"), false);
      await query("UPDATE user_security SET last_totp_step=-1 WHERE user_id=$1", [admin]);
      await query("INSERT INTO sessions(token,user_id,expires_at) VALUES('old-session',$1,now()+interval '1 hour')", [admin]);
      const code = security.authenticator("JBSWY3DPEHPK3PXP", "").generate();
      const results = await Promise.all([1,2].map(() => recovery.completePasswordReset(token, "new-hash", code)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [admin])).rows[0].n, 0);
      assert.equal(await recovery.completePasswordReset(token, "newer-hash", code), false);
    });
    let entity: string;
    await t.test("concurrent client creation cannot exceed capacity", async () => {
      const results = await Promise.allSettled([1,2].map(n => clients.createClient(firm, { name: "Client " + n }, admin)));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      entity = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<string>).value;
      assert.equal((await query("SELECT count(*)::int AS n FROM chart_of_accounts WHERE entity_id=$1", [entity])).rows[0].n, 38);
    });
    await t.test("archived clients reject normal users and reactivation is idempotent", async () => {
      await clients.setClientActive(entity, firm, false, admin);
      await assert.rejects(auth.assertEntityAccess({ id: admin, firmId: firm, role: "firm_admin", email: "", fullName: "" }, entity));
      await clients.setClientActive(entity, firm, true, admin);
      await clients.setClientActive(entity, firm, true, admin);
    });
    await t.test("audit failure rolls back the entire client provision", async () => {
      await clients.setClientActive(entity, firm, false, admin);
      await assert.rejects(clients.createClient(firm, { name: "Rollback" }, randomUUID()));
      assert.equal((await query("SELECT count(*)::int AS n FROM entities WHERE name='Rollback'")).rows[0].n, 0);
    });
    await t.test("concurrent user creation and reactivation respect limits", async () => {
      const results = await Promise.allSettled([1,2].map(n => users.createFirmUser({
        firmId: firm, email: "staff" + n + "@test.invalid", fullName: "Staff", role: "accountant_staff", password: "test-password-strong"
      }, admin)));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const user = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;
      await users.setUserActive(user.id, firm, false, admin);
      await users.createFirmUser({ firmId: firm, email: "extra@test.invalid", fullName: "Extra", role: "accountant_staff", password: "test-password-strong" }, admin);
      await assert.rejects(users.setUserActive(user.id, firm, true, admin));
    });
    await t.test("invoice posting and settlements serialize; audit failure rolls back the journal", async () => {
      const contacts = await import("../src/services/contacts");
      const invoices = await import("../src/services/invoices");
      const settlements = await import("../src/services/settlements");
      const customer = await contacts.createContact({ entityId: entity, type: "customer", name: "Buyer" }, admin);
      const date = new Date().toISOString().slice(0,10);
      const revenue = (await query("SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number='4000'", [entity])).rows[0].id;
      const invoice = await invoices.createInvoiceDraft({ entityId: entity, customerId: customer.id, issueDate: date, dueDate: date,
        lines: [{ description: "Services", quantity: "1", unitPrice: "100", revenueAccountId: revenue }] }, admin);
      const posts = await Promise.allSettled([1,2].map(() => invoices.postInvoice(invoice.id, entity, admin)));
      assert.equal(posts.filter(r => r.status === "fulfilled").length, 1);
      const bank = (await query("SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number='1000'", [entity])).rows[0].id;
      const input = { entityId: entity, invoiceId: invoice.id, kind: "payment" as const, bankAccountId: bank, date, amount: "60" };
      const receipts = await Promise.allSettled([1,2].map(() => settlements.recordSettlement(input, admin)));
      assert.equal(receipts.filter(r => r.status === "fulfilled").length, 1);
      const before = (await query("SELECT count(*)::int AS n FROM journal_entries")).rows[0].n;
      await query("CREATE FUNCTION reject_test_audit() RETURNS trigger AS $$ BEGIN IF NEW.action LIKE 'SETTLEMENT_%' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
      await query("CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_test_audit()");
      try {
        await assert.rejects(settlements.recordSettlement({ ...input, amount: "40" }, admin));
        assert.equal((await query("SELECT count(*)::int AS n FROM journal_entries")).rows[0].n, before);
        assert.equal((await query("SELECT status FROM invoices WHERE id=$1", [invoice.id])).rows[0].status, "posted");
      } finally { await query("DROP TRIGGER reject_test_audit ON audit_log"); }
    });
    await t.test("settlements reject unsafe accounts and dates without changing documents or ledger", async () => {
      const contacts = await import("../src/services/contacts");
      const invoices = await import("../src/services/invoices");
      const bills = await import("../src/services/bills");
      const settlements = await import("../src/services/settlements");
      const coa = await import("../src/services/coa");
      const date = new Date().toISOString().slice(0, 10);
      const previous = new Date(`${date}T00:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      const accounts = (await query("SELECT id,account_number FROM chart_of_accounts WHERE entity_id=$1", [entity])).rows;
      const account = (number: string) => accounts.find(a => a.account_number === number).id as string;
      const customer = await contacts.createContact({ entityId: entity, type: "customer", name: "Guard buyer" }, admin);
      const supplier = await contacts.createContact({ entityId: entity, type: "supplier", name: "Guard supplier" }, admin);
      const invoice = await invoices.createInvoiceDraft({ entityId: entity, customerId: customer.id, issueDate: date, dueDate: date,
        lines: [{ description: "Services", quantity: "1", unitPrice: "100", revenueAccountId: account("4000") }] }, admin);
      const bill = await bills.createBillDraft({ entityId: entity, supplierId: supplier.id, issueDate: date, dueDate: date,
        lines: [{ description: "Services", quantity: "1", unitPrice: "100", expenseAccountId: account("6100") }] }, admin);
      await invoices.postInvoice(invoice.id, entity, admin);
      await bills.postBill(bill.id, entity, admin);
      const foreignEntity = randomUUID(), foreignBank = randomUUID(), inactiveBank = randomUUID();
      await query("INSERT INTO entities(id,name,firm_id) VALUES($1,'Foreign guard entity',$2)", [foreignEntity, firm]);
      await query("INSERT INTO chart_of_accounts(id,entity_id,account_number,name,type,sub_type,is_active) VALUES($1,$2,'1001','Foreign bank','asset','cash_and_bank',true),($3,$4,'1002','Inactive bank','asset','cash_and_bank',false)", [foreignBank, foreignEntity, inactiveBank, entity]);
      assert.deepEqual((await coa.listCashBankAccounts(entity)).map(a => a.id), [account("1000")]);
      const before = async () => (await query(`SELECT
        (SELECT count(*) FROM journal_entries)::int AS journals,
        (SELECT count(*) FROM settlements)::int AS settlements,
        (SELECT count(*) FROM audit_log)::int AS audits`)).rows[0];
      const baseline = await before();
      for (const target of [{ invoiceId: invoice.id }, { billId: bill.id }]) {
        const input = { entityId: entity, ...target, kind: "payment" as const, bankAccountId: account("1000"), date, amount: "10" };
        for (const bankAccountId of [account("1200"), account("2100"), account("1300"), account("1510"), account("9999"), foreignBank, inactiveBank, randomUUID()]) {
          await assert.rejects(settlements.recordSettlement({ ...input, bankAccountId }, admin), /active cash or bank/);
        }
        await assert.rejects(settlements.recordSettlement({ ...input, date: previous.toISOString().slice(0, 10) }, admin), /before the document/);
        await assert.rejects(settlements.recordSettlement({ ...input, date: "2026-02-30" }, admin), /valid YYYY-MM-DD/);
        await assert.rejects(settlements.recordSettlement({ ...input, amount: "NaN" }, admin), /greater than zero/);
        await assert.rejects(settlements.recordSettlement({ ...input, fxRate: "Infinity" }, admin), /Exchange rate/);
      }
      assert.deepEqual(await before(), baseline);
      assert.equal((await query("SELECT status FROM invoices WHERE id=$1", [invoice.id])).rows[0].status, "posted");
      assert.equal((await query("SELECT status FROM bills WHERE id=$1", [bill.id])).rows[0].status, "posted");
      for (const target of [{ invoiceId: invoice.id }, { billId: bill.id }]) {
        const fx = await settlements.recordSettlement({ entityId: entity, ...target, kind: "payment", bankAccountId: account("1000"), date, amount: "10", fxRate: "2" }, admin);
        assert.equal(fx.realisedFx, "invoiceId" in target ? "10.00" : "-10.00");
        const totals = (await query("SELECT SUM(debit_base)::text AS debit, SUM(credit_base)::text AS credit FROM journal_entry_lines WHERE je_id=$1", [fx.jeId])).rows[0];
        assert.equal(totals.debit, totals.credit);
        await settlements.recordSettlement({ entityId: entity, ...target, kind: "payment", bankAccountId: account("1000"), date, amount: "90" }, admin);
      }
      assert.equal((await query("SELECT status FROM invoices WHERE id=$1", [invoice.id])).rows[0].status, "paid");
      assert.equal((await query("SELECT status FROM bills WHERE id=$1", [bill.id])).rows[0].status, "paid");
    });
    await t.test("historical AR/AP exclude future and draft journals but preserve dated reversals and FX", async () => {
      const coa = await import("../src/services/coa");
      const ageing = await import("../src/services/ageing");
      const contacts = await import("../src/services/contacts");
      const invoices = await import("../src/services/invoices");
      const bills = await import("../src/services/bills");
      const settlements = await import("../src/services/settlements");
      const journal = await import("../src/services/journal");
      const reportEntity = randomUUID();
      await query("INSERT INTO entities(id,name,firm_id) VALUES($1,'Ageing regression',$2)", [reportEntity, firm]);
      for (const a of coa.DEFAULT_COA_TEMPLATE) {
        await query("INSERT INTO chart_of_accounts(entity_id,account_number,name,type,sub_type,is_system) VALUES($1,$2,$3,$4,$5,$6)", [reportEntity,a.number,a.name,a.type,a.subType ?? null,a.system ?? false]);
      }
      const accounts = (await query("SELECT id,account_number FROM chart_of_accounts WHERE entity_id=$1", [reportEntity])).rows;
      const account = (number: string) => accounts.find(a => a.account_number === number).id as string;
      const customer = await contacts.createContact({ entityId: reportEntity, type: "customer", name: "Historical buyer" }, admin);
      const supplier = await contacts.createContact({ entityId: reportEntity, type: "supplier", name: "Historical supplier" }, admin);
      const invoice = await invoices.createInvoiceDraft({ entityId: reportEntity, customerId: customer.id, issueDate: "2026-03-15", dueDate: "2026-04-15", currency: "EUR", fxRate: "1.23456789",
        lines: [{ description: "Services", quantity: "1", unitPrice: "100", revenueAccountId: account("4000") }] }, admin);
      const bill = await bills.createBillDraft({ entityId: reportEntity, supplierId: supplier.id, issueDate: "2026-03-15", dueDate: "2026-04-15", currency: "EUR", fxRate: "1.23456789",
        lines: [{ description: "Services", quantity: "1", unitPrice: "100", expenseAccountId: account("6100") }] }, admin);
      await invoices.postInvoice(invoice.id, reportEntity, admin);
      await bills.postBill(bill.id, reportEntity, admin);
      const check = async (date: string, balance: string, tiesOut = true) => {
        for (const report of [await ageing.getArAgeing(reportEntity, date), await ageing.getApAgeing(reportEntity, date)]) {
          assert.equal(report.total, balance);
          assert.equal(report.tiesOut, tiesOut);
          if (tiesOut) assert.equal(report.controlBalance, balance);
        }
      };
      await check("2026-02-28", "0.00");
      await check("2026-03-31", "123.46");
      // Drafts never affect reports, even when dated before the report date.
      const adjustment = { entityId: reportEntity, sourceModule: "system" as const, date: "2026-03-20", description: "Ageing control adjustment", lines: [
        { accountId: account("1200"), debit: "7" }, { accountId: account("2100"), credit: "7" }] };
      await journal.saveDraftJournalEntry(adjustment, admin);
      await check("2026-03-31", "123.46");
      const posted = await journal.postJournalEntry(adjustment, admin);
      await journal.voidJournalEntry(posted.jeId, reportEntity, admin, "2026-04-20");
      for (const report of [await ageing.getArAgeing(reportEntity, "2026-03-31"), await ageing.getApAgeing(reportEntity, "2026-03-31")]) {
        assert.equal(report.controlBalance, "130.46");
        assert.equal(report.difference, "-7.00");
        assert.equal(report.tiesOut, false);
      }
      await check("2026-04-30", "123.46");
      for (const target of [{ invoiceId: invoice.id }, { billId: bill.id }]) {
        await settlements.recordSettlement({ entityId: reportEntity, ...target, kind: "payment", bankAccountId: account("1000"), date: "2026-05-10", amount: "100", fxRate: "1.3" }, admin);
      }
      // Currently-paid documents must still appear open before their settlement.
      await check("2026-02-28", "0.00");
      await check("2026-04-30", "123.46");
      await check("2026-05-31", "0.00");
    });
    await t.test("inventory tie-out uses dated movements rather than today's remaining lots", async () => {
      const f = await fixture("Historical inventory");
      const inventory = await import("../src/services/inventory");
      const item = await inventory.createItem({ entityId: f.id, sku: "HIST", name: "Historical stock", costingMethod: "fifo" }, admin);
      await inventory.recordManualMovement({ entityId: f.id, itemId: item.id, kind: "receipt", date: "2026-01-15", quantity: "10", unitCost: "20" }, admin);
      await inventory.recordManualMovement({ entityId: f.id, itemId: item.id, kind: "issue", date: "2026-02-15", quantity: "3" }, admin);
      for (const [date, expected] of [["2025-12-31", "0.00"], ["2026-01-31", "200.00"], ["2026-02-28", "140.00"]]) {
        const tie = await inventory.inventoryGlTieOut(f.id, date);
        assert.equal(tie.glBalance, expected); assert.equal(tie.subledger, expected); assert.equal(tie.inBalance, true);
      }
    });
    await t.test("closing and reopening preserve operating statements, equity and non-January fiscal periods", async () => {
      const f = await fixture("Fiscal close regression", 7);
      const journal = await import("../src/services/journal");
      const reports = await import("../src/services/statements");
      const yearEnd = await import("../src/services/year-end");
      const periods = await import("../src/services/periods");
      const post = (date: string, lines: { accountId: string; debit?: string; credit?: string }[]) => journal.postJournalEntry({ entityId: f.id, date, description: "Fiscal test", lines }, admin);
      await post("2024-08-10", [{ accountId:f.account("1000"),debit:"100" },{ accountId:f.account("4000"),credit:"100" }]);
      await post("2024-08-11", [{ accountId:f.account("6100"),debit:"20" },{ accountId:f.account("1000"),credit:"20" }]);
      await post("2024-08-12", [{ accountId:f.account("1000"),debit:"10" },{ accountId:f.account("9000"),credit:"10" }]);
      const plBefore = await reports.getProfitAndLoss(f.id,"2024-07-01","2025-06-30");
      const cfBefore = await reports.getCashFlow(f.id,"2024-07-01","2025-06-30");
      assert.equal(plBefore.netProfit,"90.00"); assert.equal(plBefore.incomeTax.total,"-10.00");
      const closes = await Promise.allSettled([1,2].map(() => yearEnd.closeFiscalYear(f.id,2024,admin)));
      assert.equal(closes.filter(c => c.status === "fulfilled").length,1);
      const close = (closes.find(c => c.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof yearEnd.closeFiscalYear>>>).value;
      assert.deepEqual(await reports.getProfitAndLoss(f.id,"2024-07-01","2025-06-30"),plBefore);
      assert.deepEqual(await reports.getCashFlow(f.id,"2024-07-01","2025-06-30"),cfBefore);
      let bs = await reports.getBalanceSheet(f.id,"2025-06-30");
      assert.equal(bs.balanced,true); assert.equal(bs.equity.total,"90.00"); assert.equal(bs.equity.currentYearProfit,"0.00");
      assert.equal((await yearEnd.getFyStatus(f.id,2024)).yearProfit,"90.00");
      assert.equal((await yearEnd.getFyStatus(f.id,2024)).periodsLocked,12);
      await assert.rejects(periods.setPeriodLock(f.id,2025,6,false,admin,undefined,"Ordinary unlock"), /Reopen the fiscal year/);
      await yearEnd.reopenFiscalYear(f.id,close.closeId,admin,"Reviewed correction and reopen");
      assert.deepEqual(await reports.getProfitAndLoss(f.id,"2024-07-01","2025-06-30"),plBefore);
      assert.equal((await reports.getBalanceSheet(f.id,"2025-06-30")).balanced,true);
      await yearEnd.closeFiscalYear(f.id,2024,admin);
      await post("2025-08-10", [{ accountId:f.account("1000"),debit:"150" },{ accountId:f.account("4000"),credit:"150" }]);
      await yearEnd.closeFiscalYear(f.id,2025,admin);
      bs = await reports.getBalanceSheet(f.id,"2026-06-30");
      assert.equal(bs.balanced,true); assert.equal(bs.equity.total,"240.00");
      assert.equal((await reports.getProfitAndLoss(f.id,"2025-07-01","2026-06-30")).netProfit,"150.00");
    });
    await t.test("contra accounts, tax receivables and suspense have correct signed statement presentation", async () => {
      const f = await fixture("Classification regression");
      const journal = await import("../src/services/journal");
      const statements = await import("../src/services/statements");
      const post = (debit: string,credit: string,amount: string) => journal.postJournalEntry({entityId:f.id,date:"2025-01-01",description:"Classification test",lines:[{accountId:f.account(debit),debit:amount},{accountId:f.account(credit),credit:amount}]},admin);
      await post("1000","3100","500"); await post("5000","1000","100"); await post("1000","5100","10");
      await post("1000","4000","200"); await post("4100","1000","20"); await post("6700","1510","30");
      await post("2400","1000","15"); await post("9999","1000","25");
      const pl = await statements.getProfitAndLoss(f.id,"2025-01-01","2025-12-31");
      assert.equal(pl.revenue.net,"180.00"); assert.equal(pl.cogs.net,"90.00"); assert.equal(pl.netProfit,"60.00");
      const bs = await statements.getBalanceSheet(f.id,"2025-12-31");
      assert.equal(bs.balanced,true); assert.equal(bs.totalAssets,"560.00");
      assert.ok(bs.currentAssets.lines.some(l => l.number === "2400" && l.amount === "15.00"));
      assert.ok(bs.currentAssets.lines.some(l => l.number === "9999" && l.amount === "25.00"));
      assert.ok(bs.nonCurrentAssets.lines.some(l => l.number === "1510" && l.amount === "-30.00"));
    });
    await t.test("suspense and empty-year closing fail atomically, with explicit classification review", async () => {
      const f = await fixture("Close guards");
      const journal = await import("../src/services/journal");
      const yearEnd = await import("../src/services/year-end");
      const periods = await import("../src/services/periods");
      const coa = await import("../src/services/coa");
      await assert.rejects(yearEnd.closeFiscalYear(f.id,2025,admin), /no posted activity/);
      assert.equal((await query("SELECT count(*)::int AS n FROM periods WHERE entity_id=$1",[f.id])).rows[0].n,0);
      const suspense = await journal.postJournalEntry({ entityId:f.id,date:"2025-03-01",description:"Suspense test",lines:[{accountId:f.account("1000"),debit:"10"},{accountId:f.account("9999"),credit:"10"}]},admin);
      await assert.rejects(yearEnd.closeFiscalYear(f.id,2025,admin), /suspense balance/);
      await periods.ensureYearPeriods(f.id,2025);
      await assert.rejects(periods.setPeriodLock(f.id,2025,3,true,admin), /suspense balance/);
      assert.equal((await query("SELECT count(*)::int AS n FROM fiscal_year_closes WHERE entity_id=$1",[f.id])).rows[0].n,0);
      const reverse = await journal.voidJournalEntry(suspense.jeId,f.id,admin,"2025-03-02");
      await assert.rejects(journal.voidJournalEntry(reverse.reversalJeId,f.id,admin), /cannot itself be reversed/);
      await periods.setPeriodLock(f.id,2025,3,true,admin);
      await assert.rejects(periods.setPeriodLock(f.id,2025,3,false,admin), /unlock reason/);
      await periods.setPeriodLock(f.id,2025,3,false,admin,undefined,"Reviewed reconciliation");
      await query("UPDATE chart_of_accounts SET type='tax' WHERE id=$1",[f.account("9999")]);
      await assert.rejects(yearEnd.closeFiscalYear(f.id,2025,admin), /classification/);
      await assert.rejects(coa.reviewClassificationCorrection(f.account("9999"),f.id,"",admin), /review/);
      await coa.reviewClassificationCorrection(f.account("9999"),f.id,"Accountant reviewed historical presentation",admin);
      assert.equal((await query("SELECT type FROM chart_of_accounts WHERE id=$1",[f.account("9999")])).rows[0].type,"asset");
    });
    await t.test("coding, mappings and manual controls cannot bypass server account-purpose rules", async () => {
      const f = await fixture("Posting purpose guards");
      const policy = await import("../src/services/account-policy");
      const journal = await import("../src/services/journal");
      const mappings = await import("../src/services/mappings");
      for (const number of ["1200","2100","1300","3200","9999","2300"]) {
        await assert.rejects(policy.assertPostingAccount(f.id,f.account(number),"category"));
        await assert.rejects(policy.assertPostingAccount(f.id,f.account(number),"bill"));
      }
      await assert.rejects(mappings.setMapping(f.id,"default_bank",f.account("1200"),admin), /not suitable/);
      await mappings.setMapping(f.id,"default_bank",f.account("1000"),admin);
      await assert.rejects(journal.postJournalEntry({ entityId:f.id,date:"2026-01-01",description:"Forbidden AR adjustment",lines:[{accountId:f.account("1200"),debit:"10"},{accountId:f.account("4000"),credit:"10"}]},admin), /Manual journals/);
    });
    await t.test("partial FX settlements clear control cents and historical ageing stays tied", async () => {
      const f = await fixture("Instalment rounding");
      const contacts = await import("../src/services/contacts");
      const invoices = await import("../src/services/invoices");
      const settlements = await import("../src/services/settlements");
      const ageing = await import("../src/services/ageing");
      const customer = await contacts.createContact({entityId:f.id,type:"customer",name:"Small instalments"},admin);
      const invoice = await invoices.createInvoiceDraft({entityId:f.id,customerId:customer.id,issueDate:"2026-01-01",dueDate:"2026-01-31",currency:"EUR",fxRate:"1.5",lines:[{description:"Small",quantity:"1",unitPrice:"0.03",revenueAccountId:f.account("4000")}]},admin);
      await invoices.postInvoice(invoice.id,f.id,admin);
      for (const date of ["2026-01-10","2026-01-20","2026-01-30"]) {
        await settlements.recordSettlement({entityId:f.id,invoiceId:invoice.id,kind:"payment",bankAccountId:f.account("1000"),date,amount:"0.01",fxRate:"1.5"},admin);
        assert.equal((await ageing.getArAgeing(f.id,date)).tiesOut,true);
      }
      const before = await ageing.getArAgeing(f.id,"2026-01-15");
      assert.equal(before.total,"0.03"); assert.equal(before.tiesOut,true);
      assert.equal((await ageing.getArAgeing(f.id,"2026-01-31")).controlBalance,"0.00");
    });
    await t.test("permission levels preserve legacy grants and cannot elevate customer or cross-firm access", async () => {
      const f = await fixture("Capability guards");
      const permissions = await import("../src/services/permissions");
      const staff = randomUUID(), customer = randomUUID();
      await query("INSERT INTO users(id,email,password_hash,full_name,role,firm_id) VALUES($1,'cap-staff@test.invalid','unused','Staff','accountant_staff',$3),($2,'cap-customer@test.invalid','unused','Customer','business_admin',$3)",[staff,customer,firm]);
      await query("INSERT INTO user_entity_access(user_id,entity_id,module_permissions) VALUES($1,$3,'{}'),($2,$3,'{}')",[staff,customer,f.id]);
      await permissions.setEntityPermissions(staff,f.id,{sales:"view"},admin);
      const user = {id:staff,firmId:firm,role:"accountant_staff" as const,email:"",fullName:""};
      assert.equal(await permissions.hasModule(user,f.id,"sales"),true);
      await assert.rejects(permissions.requireModuleEdit(user,f.id,"sales"));
      await permissions.setEntityPermissions(staff,f.id,{sales:true},admin);
      await permissions.requireModuleEdit(user,f.id,"sales");
      assert.equal(permissions.permissionAllows("business_admin","sales","approve","edit"),false);
      await assert.rejects(permissions.setEntityPermissions(customer,f.id,{sales:"edit"},admin),/read-only/);
      await assert.rejects(permissions.setEntityPermissions(staff,f.id,{sales:"approve"},admin),/Approval/);
      await assert.rejects(permissions.setEntityPermissions(staff,f.id,{sales:true},customer),/administration denied/);
      const foreignFirm = randomUUID(), foreignAdmin = randomUUID();
      await query("INSERT INTO firms(id,name) VALUES($1,'Foreign permission firm')",[foreignFirm]);
      await query("INSERT INTO users(id,email,password_hash,full_name,role,firm_id) VALUES($1,'foreign-admin@test.invalid','unused','Foreign admin','firm_admin',$2)",[foreignAdmin,foreignFirm]);
      await assert.rejects(permissions.setEntityPermissions(staff,f.id,{sales:true},foreignAdmin),/administration denied/);
    });
    await t.test("payroll posts and pays only once under concurrency", async () => {
      const employees = await import("../src/services/employees");
      const payroll = await import("../src/services/payroll");
      const date = new Date().toISOString().slice(0,10);
      const employee = await employees.createEmployee({ entityId: entity, fullName: "Test Employee", hireDate: date, payFrequency: "monthly", basicSalary: "100" }, admin);
      const run = await payroll.createPayRunDraft({ entityId: entity, periodStart: date, periodEnd: date, payDate: date, employeeIds: [employee.id] }, admin);
      const posts = await Promise.allSettled([1,2].map(() => payroll.postPayRun(run.id, entity, admin)));
      assert.equal(posts.filter(r => r.status === "fulfilled").length, 1);
      const bank = (await query("SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number='1000'", [entity])).rows[0].id;
      const payments = await Promise.allSettled([1,2].map(() => payroll.markPayRunPaid(run.id, entity, bank, admin)));
      assert.equal(payments.filter(r => r.status === "fulfilled").length, 1);
    });
    await t.test("expired trials and suspended subscriptions deny access", async () => {
      await query("UPDATE subscriptions SET status='trial', trial_ends_on=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-1 WHERE firm_id=$1", [firm]);
      assert.equal((await subscriptions.firmAccessState(firm)).allowed, false);
      await query("UPDATE subscriptions SET status='suspended' WHERE firm_id=$1", [firm]);
      assert.equal((await subscriptions.firmAccessState(firm)).allowed, false);
    });
    await t.test("bank posting is atomic and competing requests cannot post a staged row twice", async () => {
      const banking = await import("../src/services/bank-import");
      const bank = (await query("SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number='1000'", [entity])).rows[0].id;
      const category = (await query("SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number='6100'", [entity])).rows[0].id;
      const date = new Date().toISOString().slice(0,10), id = randomUUID();
      await query("INSERT INTO bank_transactions(id,entity_id,bank_account_id,txn_date,description,amount,dedupe_hash,category_account_id) VALUES($1,$2,$3,$4,'Test bank payment',-10,$6,$5)", [id,entity,bank,date,category,id]);
      const results = await Promise.all([1,2].map(() => banking.postBankTransactions(entity, [id], admin)));
      assert.equal(results.reduce((n,r) => n+r.posted, 0), 1);
      assert.equal(results.reduce((n,r) => n+r.failed.length, 0), 0);
    });
    await t.test("year-end reopening rolls back period unlock and reversal when auditing fails", async () => {
      const yearEnd = await import("../src/services/year-end");
      const close = await yearEnd.closeFiscalYear(entity, new Date().getFullYear(), admin);
      await query("CREATE FUNCTION reject_reopen_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='FY_REOPENED' THEN RAISE EXCEPTION 'test reopen audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
      await query("CREATE TRIGGER reject_reopen_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_reopen_audit()");
      try {
        await assert.rejects(yearEnd.reopenFiscalYear(entity, close.closeId, admin, "Regression audit rollback"));
        assert.equal((await query("SELECT reopened_at FROM fiscal_year_closes WHERE id=$1", [close.closeId])).rows[0].reopened_at, null);
        assert.equal((await query("SELECT is_locked FROM periods WHERE entity_id=$1 AND month=12", [entity])).rows[0].is_locked, true);
        if (close.jeId) assert.equal((await query("SELECT status FROM journal_entries WHERE id=$1", [close.jeId])).rows[0].status, "posted");
      } finally { await query("DROP TRIGGER reject_reopen_audit ON audit_log"); }
      await yearEnd.reopenFiscalYear(entity, close.closeId, admin, "Regression reopen completed");
    });
    if (process.env.LEDGER_HTTP_SMOKE === "1") await t.test("local production HTTP smoke: four portals, updated forms and role isolation", { timeout: 60000 }, async () => {
      const f = await fixture("HTTP smoke client");
      await query("UPDATE subscriptions SET status='active' WHERE firm_id=$1",[firm]);
      const actors = new Map<string,string>();
      const actorIds = new Map<string,string>();
      for (const role of ["platform_admin","firm_owner","accountant_staff","business_admin"]) {
        const id = randomUUID(), token = randomBytes(32).toString("hex");
        await query("INSERT INTO users(id,email,password_hash,full_name,role,firm_id) VALUES($1,$2,'unused','HTTP smoke user',$3,$4)",[id,`${role}-http@test.invalid`,role,role === "platform_admin" ? null : firm]);
        await query("INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[token,id]);
        await query("INSERT INTO user_entity_access(user_id,entity_id,module_permissions) VALUES($1,$2,$3::jsonb)",[id,f.id,JSON.stringify({coa:true,journal:true,sales:true,purchases:true,banking:true,reports:true,periods:true,admin:true,payroll:true,inventory:true})]);
        actors.set(role, token);
        actorIds.set(role, id);
      }
      const listener = createServer();
      await new Promise<void>(r => listener.listen(0,"127.0.0.1",r));
      const appPort = (listener.address() as { port:number }).port;
      await new Promise<void>(r => listener.close(() => r()));
      let output = "";
      const app = spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(appPort)], {
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL!, APP_URL: `http://127.0.0.1:${appPort}` }, windowsHide:true, stdio:["ignore","pipe","pipe"]
      });
      app.stdout.on("data", data => { output = (output+String(data)).slice(-4000); });
      app.stderr.on("data", data => { output = (output+String(data)).slice(-4000); });
      const request = (path:string,role?:string) => fetch(`http://127.0.0.1:${appPort}${path}`, {
        redirect:"manual", headers: role ? {cookie:`session=${actors.get(role)}`} : {}, signal:AbortSignal.timeout(10000)
      });
      try {
        const deadline = Date.now()+30000;
        let ready = false;
        while (Date.now()<deadline && app.exitCode === null) {
          try { if ((await request("/login")).status === 200) { ready = true; break; } } catch { /* startup */ }
          await new Promise(r => setTimeout(r,100));
        }
        assert.ok(ready,"Local test server failed to start: "+output);
        for (const [role,path] of [["platform_admin","/platform"],["firm_owner","/firm"],["accountant_staff",`/accountant/${f.id}/reports/profit-loss`],["business_admin","/business"]]) {
          const response = await request(path,role);
          assert.equal(response.status,200,`${role} portal: ${output}`);
          assert.ok((await response.text()).length>500);
        }
        const anonymous = await request(`/accountant/${f.id}/coa`);
        assert.equal(anonymous.status,307); assert.ok(anonymous.headers.get("location")?.includes("/login"));
        const customer = await request(`/accountant/${f.id}/coa`,"business_admin");
        assert.equal(customer.status,307);
        const coa = await request(`/accountant/${f.id}/coa`,"firm_owner");
        assert.equal(coa.status,200);
        const coaHtml = await coa.text();
        assert.ok(coaHtml.includes("Edit / review"));
        // Exercise a real server-action form: denial must not be just a hidden button.
        const toggleForm = coaHtml.match(/<form\b[^>]*>[\s\S]*?<\/form>/g)?.find(form => form.includes('name="makeActive"'));
        const actionId = toggleForm?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
        assert.ok(actionId,"Account toggle server action was not rendered");
        await query("UPDATE user_entity_access SET module_permissions=jsonb_set(module_permissions,'{coa}','\"view\"') WHERE user_id=$1 AND entity_id=$2",[actorIds.get("accountant_staff"),f.id]);
        const postToggle = (role:string) => {
          const body = new FormData();
          for (const [key,value] of Object.entries({ [actionId!]:"",entityId:f.id,accountId:f.account("6100"),makeActive:"false" })) body.set(key,value);
          return fetch(`http://127.0.0.1:${appPort}/accountant/${f.id}/coa`,{method:"POST",redirect:"manual",
            headers:{cookie:`session=${actors.get(role)}`,origin:`http://127.0.0.1:${appPort}`},body,
            signal:AbortSignal.timeout(10000)});
        };
        for (const role of ["accountant_staff","business_admin"]) {
          await postToggle(role);
          assert.equal((await query("SELECT is_active FROM chart_of_accounts WHERE id=$1",[f.account("6100")])).rows[0].is_active,true);
        }
        const approvedToggle = await postToggle("firm_owner");
        assert.ok([200,303].includes(approvedToggle.status));
        assert.equal((await query("SELECT is_active FROM chart_of_accounts WHERE id=$1",[f.account("6100")])).rows[0].is_active,false);
        const periods = await request(`/accountant/${f.id}/periods`,"firm_owner");
        assert.equal(periods.status,200);
        const unauthorised = await request(`/accountant/${randomUUID()}/reports/profit-loss`,"accountant_staff");
        assert.equal(unauthorised.status,404);
      } finally {
        if (app.exitCode === null) {
          const stopped = new Promise<void>(r => app.once("exit",() => r()));
          app.kill(); await stopped;
        }
      }
    });
  } finally {
    await pool?.end();
    if (process.platform === "win32") execFileSync(pgCtl, ["stop", "-D", directory, "-m", "fast", "-w"], { windowsHide: true });
    else await postgres.stop();
    console.log("Isolated test cluster stopped; diagnostic files retained at " + directory);
  }
});
