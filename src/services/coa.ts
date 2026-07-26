import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chartOfAccounts } from "@/db/schema";
import { writeAudit } from "@/services/audit";

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "cogs"
  | "expense"
  | "other_income"
  | "other_expense"
  | "tax";

/**
 * Default COA template (spec section 3 + account numbers used throughout the
 * spec's journal mappings). Seeded for every new entity; accountants customise
 * from there. `system: true` accounts cannot be deleted.
 */
export const DEFAULT_COA_TEMPLATE: {
  number: string;
  name: string;
  type: AccountType;
  subType?: string;
  system?: boolean;
}[] = [
  // 1xxx Assets
  { number: "1000", name: "Bank / Cash", type: "asset", subType: "cash_and_bank" },
  { number: "1200", name: "Accounts Receivable", type: "asset", subType: "receivable", system: true },
  { number: "1300", name: "Inventory", type: "asset", subType: "inventory" },
  { number: "1400", name: "Prepayments", type: "asset", subType: "prepayment" },
  { number: "1500", name: "Fixed Assets", type: "asset", subType: "fixed_asset" },
  { number: "1510", name: "Accumulated Depreciation", type: "asset", subType: "contra_asset" },
  // 2xxx Liabilities
  { number: "2100", name: "Accounts Payable", type: "liability", subType: "payable", system: true },
  { number: "2150", name: "Goods Received Not Invoiced", type: "liability", subType: "accrual" },
  { number: "2200", name: "Salaries Payable", type: "liability", subType: "payroll" },
  { number: "2210", name: "Payroll Tax Payable", type: "liability", subType: "payroll" },
  { number: "2220", name: "Tax Deducted at Source Payable", type: "liability", subType: "payroll" },
  { number: "2230", name: "Pension / EOBI Payable", type: "liability", subType: "payroll" },
  { number: "2300", name: "Sales Tax Payable", type: "liability", subType: "tax", system: true },
  { number: "2400", name: "Input Tax Receivable", type: "liability", subType: "tax" },
  { number: "2500", name: "Loans Payable", type: "liability", subType: "loan" },
  // 3xxx Equity
  { number: "3100", name: "Owner's Capital", type: "equity" },
  { number: "3200", name: "Retained Earnings", type: "equity", system: true },
  { number: "3300", name: "Owner's Drawings", type: "equity" },
  // 4xxx Revenue
  { number: "4000", name: "Sales Revenue", type: "revenue" },
  { number: "4100", name: "Sales Discounts & Returns", type: "revenue", subType: "contra_revenue" },
  { number: "4500", name: "Service Income", type: "revenue" },
  // 5xxx COGS
  { number: "5000", name: "Cost of Goods Sold", type: "cogs" },
  { number: "5100", name: "Purchase Discounts", type: "cogs", subType: "contra_cogs" },
  // 6xxx Operating Expenses
  { number: "6100", name: "Rent Expense", type: "expense" },
  { number: "6200", name: "Salaries & Wages Expense", type: "expense" },
  { number: "6210", name: "Payroll Tax Expense", type: "expense" },
  { number: "6300", name: "Utilities Expense", type: "expense" },
  { number: "6400", name: "Marketing Expense", type: "expense" },
  { number: "6500", name: "Bad Debt Expense", type: "expense" },
  { number: "6600", name: "Inventory Write-Down Expense", type: "expense" },
  { number: "6700", name: "Depreciation Expense", type: "expense" },
  { number: "6800", name: "Bank Charges", type: "expense" },
  // 7xxx / 8xxx Other
  { number: "7100", name: "Gain on Asset Sale", type: "other_income" },
  { number: "7200", name: "Foreign Exchange Gain", type: "other_income", subType: "fx" },
  { number: "8100", name: "Interest Expense", type: "other_expense" },
  { number: "8200", name: "Foreign Exchange Loss", type: "other_expense", subType: "fx" },
  // 9xxx Tax
  { number: "9000", name: "Income Tax Expense", type: "tax" },
  { number: "9999", name: "Suspense", type: "tax", subType: "suspense", system: true },
];

export async function listAccounts(entityId: string) {
  return db
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.entityId, entityId))
    .orderBy(asc(chartOfAccounts.accountNumber));
}

export async function createAccount(
  input: {
    entityId: string;
    accountNumber: string;
    name: string;
    type: AccountType;
    subType?: string;
    parentId?: string;
    currency?: string;
    taxCode?: string;
  },
  userId: string
) {
  const [account] = await db
    .insert(chartOfAccounts)
    .values({
      entityId: input.entityId,
      accountNumber: input.accountNumber.trim(),
      name: input.name.trim(),
      type: input.type,
      subType: input.subType,
      parentId: input.parentId,
      currency: input.currency,
      taxCode: input.taxCode,
    })
    .returning();

  await writeAudit(db, {
    entityId: input.entityId,
    userId,
    action: "COA_CREATED",
    tableName: "chart_of_accounts",
    recordId: account.id,
    afterState: { accountNumber: account.accountNumber, name: account.name, type: account.type },
  });
  return account;
}

export async function updateAccount(
  accountId: string,
  entityId: string,
  changes: { name?: string; accountNumber?: string; subType?: string; taxCode?: string; isActive?: boolean },
  userId: string
) {
  const beforeRows = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.id, accountId), eq(chartOfAccounts.entityId, entityId)));
  const before = beforeRows[0];
  if (!before) throw new Error("Account not found");

  const [after] = await db
    .update(chartOfAccounts)
    .set(changes)
    .where(and(eq(chartOfAccounts.id, accountId), eq(chartOfAccounts.entityId, entityId)))
    .returning();

  await writeAudit(db, {
    entityId,
    userId,
    action: "COA_UPDATED",
    tableName: "chart_of_accounts",
    recordId: accountId,
    beforeState: {
      name: before.name,
      accountNumber: before.accountNumber,
      isActive: before.isActive,
    },
    afterState: { name: after.name, accountNumber: after.accountNumber, isActive: after.isActive },
  });
  return after;
}

/** Seed the default COA for a new entity. Idempotent per (entity, account number). */
export async function seedDefaultCoa(entityId: string) {
  await db
    .insert(chartOfAccounts)
    .values(
      DEFAULT_COA_TEMPLATE.map((a) => ({
        entityId,
        accountNumber: a.number,
        name: a.name,
        type: a.type,
        subType: a.subType,
        isSystem: a.system ?? false,
      }))
    )
    .onConflictDoNothing();
}
