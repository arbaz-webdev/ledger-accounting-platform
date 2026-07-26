// Seeds account mappings + demo customers/suppliers for Acme Trading Ltd.
// Invoices and bills themselves are created through the UI/services so they go
// through the real posting path. Idempotent.
import pg from "pg";
import "dotenv/config";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const entityId = (await c.query(`SELECT id FROM entities WHERE name='Acme Trading Ltd'`)).rows[0].id;

const MAPPINGS = [
  ["invoice", "ar_control", "1200"],
  ["invoice", "sales_revenue", "4000"],
  ["invoice", "sales_tax_payable", "2300"],
  ["invoice", "sales_discounts", "4100"],
  ["invoice", "bad_debt_expense", "6500"],
  ["bill", "ap_control", "2100"],
  ["bill", "input_tax", "2400"],
  ["bill", "purchase_discounts", "5100"],
  ["bill", "default_expense", "5000"],
  ["banking", "default_bank", "1000"],
];

let mapped = 0;
for (const [module, key, accountNumber] of MAPPINGS) {
  const acct = (
    await c.query(
      `SELECT id FROM chart_of_accounts WHERE entity_id=$1 AND account_number=$2`,
      [entityId, accountNumber]
    )
  ).rows[0];
  if (!acct) {
    console.warn(`  ! account ${accountNumber} missing — skipped ${key}`);
    continue;
  }
  const res = await c.query(
    `INSERT INTO account_mappings (entity_id, module, key, account_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (entity_id, module, key) DO NOTHING`,
    [entityId, module, key, acct.id]
  );
  mapped += res.rowCount;
}
console.log(`Account mappings: ${mapped} inserted (${MAPPINGS.length} total defined).`);

const CONTACTS = [
  ["customer", "Northwind Trading", "ap@northwind.example", 30],
  ["customer", "Contoso Manufacturing", "accounts@contoso.example", 14],
  ["customer", "Fabrikam Retail", "billing@fabrikam.example", 45],
  ["supplier", "Global Components Ltd", "sales@globalcomp.example", 30],
  ["supplier", "City Office Supplies", "orders@cityoffice.example", 14],
];

let added = 0;
for (const [type, name, email, terms] of CONTACTS) {
  const res = await c.query(
    `INSERT INTO contacts (entity_id, type, name, email, payment_terms_days)
     SELECT $1,$2,$3,$4,$5
     WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE entity_id=$1 AND name=$3)`,
    [entityId, type, name, email, terms]
  );
  added += res.rowCount;
}
console.log(`Contacts: ${added} added (${CONTACTS.length} defined).`);

await c.end();
