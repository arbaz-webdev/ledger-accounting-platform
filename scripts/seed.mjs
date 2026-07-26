// Development seed: demo firm, users, client entity, default COA, periods.
// Idempotent — safe to run repeatedly.
import pg from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

// Mirrors DEFAULT_COA_TEMPLATE in src/services/coa.ts
const COA = [
  ["1000", "Bank / Cash", "asset", "cash_and_bank", false],
  ["1200", "Accounts Receivable", "asset", "receivable", true],
  ["1300", "Inventory", "asset", "inventory", false],
  ["1400", "Prepayments", "asset", "prepayment", false],
  ["1500", "Fixed Assets", "asset", "fixed_asset", false],
  ["1510", "Accumulated Depreciation", "asset", "contra_asset", false],
  ["2100", "Accounts Payable", "liability", "payable", true],
  ["2150", "Goods Received Not Invoiced", "liability", "accrual", false],
  ["2200", "Salaries Payable", "liability", "payroll", false],
  ["2210", "Payroll Tax Payable", "liability", "payroll", false],
  ["2220", "Tax Deducted at Source Payable", "liability", "payroll", false],
  ["2230", "Pension / EOBI Payable", "liability", "payroll", false],
  ["2300", "Sales Tax Payable", "liability", "tax", true],
  ["2400", "Input Tax Receivable", "liability", "tax", false],
  ["2500", "Loans Payable", "liability", "loan", false],
  ["3100", "Owner's Capital", "equity", null, false],
  ["3200", "Retained Earnings", "equity", null, true],
  ["3300", "Owner's Drawings", "equity", null, false],
  ["4000", "Sales Revenue", "revenue", null, false],
  ["4100", "Sales Discounts & Returns", "revenue", "contra_revenue", false],
  ["4500", "Service Income", "revenue", null, false],
  ["5000", "Cost of Goods Sold", "cogs", null, false],
  ["5100", "Purchase Discounts", "cogs", "contra_cogs", false],
  ["6100", "Rent Expense", "expense", null, false],
  ["6200", "Salaries & Wages Expense", "expense", null, false],
  ["6210", "Payroll Tax Expense", "expense", null, false],
  ["6300", "Utilities Expense", "expense", null, false],
  ["6400", "Marketing Expense", "expense", null, false],
  ["6500", "Bad Debt Expense", "expense", null, false],
  ["6600", "Inventory Write-Down Expense", "expense", null, false],
  ["6700", "Depreciation Expense", "expense", null, false],
  ["6800", "Bank Charges", "expense", null, false],
  ["7100", "Gain on Asset Sale", "other_income", null, false],
  ["7200", "Foreign Exchange Gain", "other_income", "fx", false],
  ["8100", "Interest Expense", "other_expense", null, false],
  ["8200", "Foreign Exchange Loss", "other_expense", "fx", false],
  ["9000", "Income Tax Expense", "tax", null, false],
  ["9999", "Suspense", "tax", "suspense", true],
];

async function main() {
  await client.connect();

  const firmRes = await client.query(
    `INSERT INTO firms (name)
     SELECT 'Demo Accounting Firm'
     WHERE NOT EXISTS (SELECT 1 FROM firms WHERE name = 'Demo Accounting Firm')
     RETURNING id`
  );
  const firmId =
    firmRes.rows[0]?.id ??
    (await client.query(`SELECT id FROM firms WHERE name = 'Demo Accounting Firm'`)).rows[0].id;

  const passwordHash = await bcrypt.hash("demo1234", 12);

  await client.query(
    `INSERT INTO users (firm_id, email, password_hash, full_name, role)
     VALUES ($1, 'accountant@demo.test', $2, 'Ayesha Accountant', 'firm_admin')
     ON CONFLICT (email) DO NOTHING`,
    [firmId, passwordHash]
  );

  const entityRes = await client.query(
    `INSERT INTO entities (firm_id, name, legal_name, base_currency)
     SELECT $1, 'Acme Trading Ltd', 'Acme Trading Limited', 'USD'
     WHERE NOT EXISTS (SELECT 1 FROM entities WHERE name = 'Acme Trading Ltd' AND firm_id = $1)
     RETURNING id`,
    [firmId]
  );
  const entityId =
    entityRes.rows[0]?.id ??
    (
      await client.query(
        `SELECT id FROM entities WHERE name = 'Acme Trading Ltd' AND firm_id = $1`,
        [firmId]
      )
    ).rows[0].id;

  await client.query(
    `INSERT INTO users (firm_id, email, password_hash, full_name, role)
     VALUES ($1, 'owner@demo.test', $2, 'Omar Owner', 'business_admin')
     ON CONFLICT (email) DO NOTHING`,
    [firmId, passwordHash]
  );
  const ownerId = (
    await client.query(`SELECT id FROM users WHERE email = 'owner@demo.test'`)
  ).rows[0].id;

  await client.query(
    `INSERT INTO user_entity_access (user_id, entity_id, module_permissions)
     VALUES ($1, $2, '{"sales": true, "purchases": true, "reports": true}')
     ON CONFLICT DO NOTHING`,
    [ownerId, entityId]
  );

  for (const [number, name, type, subType, isSystem] of COA) {
    await client.query(
      `INSERT INTO chart_of_accounts (entity_id, account_number, name, type, sub_type, is_system)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entity_id, account_number) DO NOTHING`,
      [entityId, number, name, type, subType, isSystem]
    );
  }

  const year = new Date().getFullYear();
  for (let month = 1; month <= 12; month++) {
    await client.query(
      `INSERT INTO periods (entity_id, year, month) VALUES ($1, $2, $3)
       ON CONFLICT (entity_id, year, month) DO NOTHING`,
      [entityId, year, month]
    );
  }

  console.log("Seed complete:");
  console.log("  Accountant login: accountant@demo.test / demo1234");
  console.log("  Business login:   owner@demo.test / demo1234");
  console.log(`  Entity: Acme Trading Ltd (${COA.length} accounts, ${year} periods)`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
