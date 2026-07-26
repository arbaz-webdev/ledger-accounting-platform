// Seeds a realistic set of posted transactions for Acme Trading Ltd so the
// financial statements have meaningful numbers. Idempotent via SCN-* references.
// Goes through the same DB triggers as the app (balanced, period-open, active).
import pg from "pg";
import "dotenv/config";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const entityId = (await c.query(`SELECT id FROM entities WHERE name='Acme Trading Ltd'`)).rows[0].id;
const userId = (await c.query(`SELECT id FROM users WHERE email='accountant@demo.test'`)).rows[0].id;

const already = await c.query(
  `SELECT 1 FROM journal_entries WHERE entity_id=$1 AND reference LIKE 'SCN-%' LIMIT 1`,
  [entityId]
);
if (already.rowCount > 0) {
  console.log("Scenario already seeded — skipping.");
  await c.end();
  process.exit(0);
}

const acct = async (n) =>
  (await c.query(`SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number=$2`, [entityId, n]))
    .rows[0].id;

// account cache
const A = {};
for (const n of ["1000", "1200", "1300", "1500", "1510", "2100", "2500", "3100", "4000", "5000", "6100", "6700"]) {
  A[n] = await acct(n);
}

async function postJE(date, description, reference, lines) {
  await c.query("BEGIN");
  try {
    const { rows } = await c.query(
      `INSERT INTO journal_entries (entity_id, je_number, date, reference, description, source_module, status, created_by, posted_by, posted_at)
       VALUES ($1, next_je_number($1), $2, $3, $4, 'manual', 'posted', $5, $5, now()) RETURNING id`,
      [entityId, date, reference, description, userId]
    );
    const jeId = rows[0].id;
    let lineNo = 1;
    for (const [accountNum, debit, credit] of lines) {
      await c.query(
        `INSERT INTO journal_entry_lines (je_id, line_no, account_id, currency, debit, credit, debit_base, credit_base)
         VALUES ($1,$2,$3,'USD',$4,$5,$4,$5)`,
        [jeId, lineNo++, A[accountNum], debit, credit]
      );
    }
    await c.query("COMMIT");
    console.log(`  posted ${reference}: ${description}`);
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
}

// [accountNumber, debit, credit]
await postJE("2026-02-01", "Owner capital injection", "SCN-01", [["1000", 50000, 0], ["3100", 0, 50000]]);
await postJE("2026-02-05", "Bank loan received", "SCN-02", [["1000", 20000, 0], ["2500", 0, 20000]]);
await postJE("2026-02-10", "Purchase delivery van", "SCN-03", [["1500", 15000, 0], ["1000", 0, 15000]]);
await postJE("2026-03-01", "Purchase inventory on credit", "SCN-04", [["1300", 8000, 0], ["2100", 0, 8000]]);
await postJE("2026-03-15", "Sale to customer on credit", "SCN-05", [["1200", 12000, 0], ["4000", 0, 12000]]);
await postJE("2026-03-15", "Cost of goods sold", "SCN-06", [["5000", 5000, 0], ["1300", 0, 5000]]);
await postJE("2026-04-01", "Customer payment received", "SCN-07", [["1000", 7000, 0], ["1200", 0, 7000]]);
await postJE("2026-04-10", "Supplier payment", "SCN-08", [["2100", 3000, 0], ["1000", 0, 3000]]);
await postJE("2026-05-01", "Office rent", "SCN-09", [["6100", 2000, 0], ["1000", 0, 2000]]);
await postJE("2026-06-30", "Monthly depreciation", "SCN-10", [["6700", 1250, 0], ["1510", 0, 1250]]);

console.log("Scenario seeded (10 transactions).");
await c.end();
