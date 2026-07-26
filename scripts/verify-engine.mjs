// Adversarial verification of the ledger engine's DATABASE-LEVEL rules.
// Bypasses the application entirely — raw SQL against the DB — to prove the
// spec 16.2 constraints hold even if application code is buggy or bypassed.
import pg from "pg";
import "dotenv/config";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let pass = 0;
let fail = 0;

async function expectReject(name, fn, expectedFragment) {
  try {
    await client.query("BEGIN");
    await fn();
    await client.query("COMMIT");
    console.log(`  FAIL  ${name} — was ACCEPTED but must be rejected`);
    fail++;
  } catch (err) {
    await client.query("ROLLBACK");
    if (!expectedFragment || err.message.includes(expectedFragment)) {
      console.log(`  ok    ${name}`);
      pass++;
    } else {
      console.log(`  FAIL  ${name} — rejected but with unexpected error: ${err.message}`);
      fail++;
    }
  }
}

async function expectAccept(name, fn) {
  try {
    await client.query("BEGIN");
    await fn();
    // Force DEFERRED constraints (the balance check) to fire now, so we verify
    // a balanced entry passes — then ROLL BACK so the script leaves no residue
    // in the ledger. (Posted JEs are immutable, so committing then deleting
    // isn't an option; this keeps verify-engine idempotent.)
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("ROLLBACK");
    console.log(`  ok    ${name}`);
    pass++;
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(`  FAIL  ${name} — should be accepted but got: ${err.message}`);
    fail++;
  }
}

async function main() {
  await client.connect();

  const { rows: entityRows } = await client.query(
    `SELECT id FROM entities WHERE name = 'Acme Trading Ltd'`
  );
  const entityId = entityRows[0].id;
  const { rows: userRows } = await client.query(
    `SELECT id FROM users WHERE email = 'accountant@demo.test'`
  );
  const userId = userRows[0].id;
  const acct = async (num) =>
    (
      await client.query(
        `SELECT id FROM chart_of_accounts WHERE entity_id = $1 AND account_number = $2`,
        [entityId, num]
      )
    ).rows[0].id;

  const bank = await acct("1000");
  const rent = await acct("6100");

  const insertJe = async (status = "posted", date = "2026-07-10") => {
    const { rows } = await client.query(
      `INSERT INTO journal_entries (entity_id, je_number, date, description, status, created_by, posted_by, posted_at)
       VALUES ($1, next_je_number($1), $2, 'verify-engine probe', $3, $4, $4, now())
       RETURNING id`,
      [entityId, date, status, userId]
    );
    return rows[0].id;
  };
  const insertLine = (jeId, accountId, debit, credit, lineNo = 1) =>
    client.query(
      `INSERT INTO journal_entry_lines (je_id, line_no, account_id, currency, debit, credit, debit_base, credit_base)
       VALUES ($1, $2, $3, 'USD', $4, $5, $4, $5)`,
      [jeId, lineNo, accountId, debit, credit]
    );

  console.log("Rule 1 — double-entry balance enforced at commit:");
  await expectReject(
    "unbalanced JE (DR 100 / CR 90)",
    async () => {
      const je = await insertJe();
      await insertLine(je, rent, 100, 0, 1);
      await insertLine(je, bank, 0, 90, 2);
    },
    "unbalanced"
  );
  await expectReject(
    "single-line JE",
    async () => {
      const je = await insertJe();
      await insertLine(je, rent, 100, 0, 1);
    },
    "at least 2 lines"
  );
  await expectAccept("balanced JE (DR 250 / CR 250)", async () => {
    const je = await insertJe();
    await insertLine(je, rent, 250, 0, 1);
    await insertLine(je, bank, 0, 250, 2);
  });

  console.log("Rule 2 — period lock enforced in the database:");
  await client.query(
    `UPDATE periods SET is_locked = true WHERE entity_id = $1 AND year = 2026 AND month = 3`,
    [entityId]
  );
  await expectReject(
    "posting into locked 2026-03",
    async () => {
      const je = await insertJe("posted", "2026-03-15");
      await insertLine(je, rent, 50, 0, 1);
      await insertLine(je, bank, 0, 50, 2);
    },
    "locked"
  );
  await client.query(
    `UPDATE periods SET is_locked = false WHERE entity_id = $1 AND year = 2026 AND month = 3`,
    [entityId]
  );

  console.log("Rule 3 — posted entries are immutable:");
  const { rows: postedRows } = await client.query(
    `SELECT je.id FROM journal_entries je WHERE je.entity_id = $1 AND je.status = 'posted' LIMIT 1`,
    [entityId]
  );
  const postedId = postedRows[0].id;
  await expectReject(
    "UPDATE posted JE description",
    () =>
      client.query(`UPDATE journal_entries SET description = 'hacked' WHERE id = $1`, [postedId]),
    "immutable"
  );
  await expectReject(
    "UPDATE posted JE line amount",
    () =>
      client.query(
        `UPDATE journal_entry_lines SET debit = 999999, debit_base = 999999 WHERE je_id = $1 AND debit > 0`,
        [postedId]
      ),
    "immutable"
  );
  await expectReject(
    "DELETE posted JE",
    () => client.query(`DELETE FROM journal_entries WHERE id = $1`, [postedId]),
    "cannot be deleted"
  );

  console.log("Rule 4 — account validation:");
  await expectReject(
    "posting to an inactive account",
    async () => {
      await client.query(`UPDATE chart_of_accounts SET is_active = false WHERE id = $1`, [rent]);
      const je = await insertJe();
      await insertLine(je, rent, 10, 0, 1);
      await insertLine(je, bank, 0, 10, 2);
    },
    "inactive"
  );
  await client.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = $1`, [rent]);

  console.log("Rule 5 — audit log is append-only:");
  await expectReject(
    "UPDATE audit_log row",
    () => client.query(`UPDATE audit_log SET action = 'TAMPERED' WHERE id = (SELECT min(id) FROM audit_log)`),
    "append-only"
  );
  await expectReject(
    "DELETE audit_log row",
    () => client.query(`DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log)`),
    "append-only"
  );

  console.log("Rule 6 — system accounts protected:");
  await expectReject(
    "DELETE Retained Earnings (system account)",
    () =>
      client.query(
        `DELETE FROM chart_of_accounts WHERE entity_id = $1 AND account_number = '3200'`,
        [entityId]
      ),
    "cannot be deleted"
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  await client.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
