import pg from "pg"; import "dotenv/config";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const entityId = (await c.query(`SELECT id FROM entities WHERE name='Acme Trading Ltd'`)).rows[0].id;
const userId = (await c.query(`SELECT id FROM users WHERE email='accountant@demo.test'`)).rows[0].id;
const RULES = [
  [10, "contains", "RENT", "money_out", "6100"],
  [20, "contains", "BANK CHARGES", "money_out", "6800"],
  [30, "contains", "UTILITIES", "money_out", "6300"],
  [40, "contains", "CUSTOMER PAYMENT", "money_in", "1200"],
  [50, "contains", "SUPPLIER PAYMENT", "money_out", "2100"],
];
let n = 0;
for (const [priority, matchType, matchText, direction, acctNum] of RULES) {
  const acct = (await c.query(`SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number=$2`, [entityId, acctNum])).rows[0];
  if (!acct) { console.warn(`  ! account ${acctNum} missing`); continue; }
  const res = await c.query(
    `INSERT INTO bank_rules (entity_id, priority, match_type, match_text, direction, account_id, created_by)
     SELECT $1,$2,$3,$4,$5,$6,$7
     WHERE NOT EXISTS (SELECT 1 FROM bank_rules WHERE entity_id=$1 AND match_text=$4 AND direction=$5)`,
    [entityId, priority, matchType, matchText, direction, acct.id, userId]);
  n += res.rowCount;
}
console.log(`Bank rules seeded: ${n}`);
await c.end();
