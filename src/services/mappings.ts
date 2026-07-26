import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountMappings, chartOfAccounts } from "@/db/schema";
import { writeAudit } from "@/services/audit";

/**
 * Account Mapping Engine (spec 4.2 and 16.4).
 *
 * Modules never hard-code account numbers. Each event type resolves its
 * debit/credit accounts through this table, which the accountant configures per
 * client. Changes apply to future transactions only — already-posted journal
 * entries are immutable and keep the accounts they were posted with.
 */

export type MappingKey =
  // Invoicing / AR
  | "ar_control"
  | "sales_revenue"
  | "sales_tax_payable"
  | "sales_discounts"
  | "bad_debt_expense"
  // Bills / AP
  | "ap_control"
  | "input_tax"
  | "purchase_discounts"
  | "default_expense"
  // Banking
  | "default_bank"
  | "suspense"
  // Payroll
  | "salaries_payable"
  | "income_tax_payable"
  | "eobi_payable"
  | "payroll_tax_payable"
  | "salaries_expense"
  | "payroll_tax_expense"
  // Inventory
  | "inventory_asset"
  | "cogs"
  | "inventory_writedown"
  | "grni"
  // Period / year-end close
  | "retained_earnings"
  // Foreign exchange
  | "fx_gain"
  | "fx_loss";

export type MappingDef = {
  key: MappingKey;
  module: "invoice" | "bill" | "banking" | "payroll" | "inventory" | "close" | "fx";
  label: string;
  hint: string;
  /** Account number seeded from the default COA when none is configured. */
  defaultAccountNumber: string;
};

export const MAPPING_DEFS: MappingDef[] = [
  {
    key: "ar_control",
    module: "invoice",
    label: "Accounts Receivable (control)",
    hint: "Debited for the gross total of every posted invoice.",
    defaultAccountNumber: "1200",
  },
  {
    key: "sales_revenue",
    module: "invoice",
    label: "Default sales revenue",
    hint: "Credited with the net amount when an invoice line has no specific account.",
    defaultAccountNumber: "4000",
  },
  {
    key: "sales_tax_payable",
    module: "invoice",
    label: "Sales tax payable",
    hint: "Credited with the tax portion of invoices.",
    defaultAccountNumber: "2300",
  },
  {
    key: "sales_discounts",
    module: "invoice",
    label: "Sales discounts / credit notes",
    hint: "Debited when a credit note is issued to a customer.",
    defaultAccountNumber: "4100",
  },
  {
    key: "bad_debt_expense",
    module: "invoice",
    label: "Bad debt expense",
    hint: "Debited when an invoice is written off as uncollectable.",
    defaultAccountNumber: "6500",
  },
  {
    key: "ap_control",
    module: "bill",
    label: "Accounts Payable (control)",
    hint: "Credited for the gross total of every posted bill.",
    defaultAccountNumber: "2100",
  },
  {
    key: "input_tax",
    module: "bill",
    label: "Input tax receivable",
    hint: "Debited with the recoverable tax portion of bills.",
    defaultAccountNumber: "2400",
  },
  {
    key: "purchase_discounts",
    module: "bill",
    label: "Purchase discounts / supplier credits",
    hint: "Credited when a supplier issues a credit note.",
    defaultAccountNumber: "5100",
  },
  {
    key: "default_expense",
    module: "bill",
    label: "Default expense account",
    hint: "Used for bill lines with no specific account selected.",
    defaultAccountNumber: "5000",
  },
  {
    key: "default_bank",
    module: "banking",
    label: "Default bank account",
    hint: "Pre-selected when recording customer receipts and supplier payments.",
    defaultAccountNumber: "1000",
  },
  {
    key: "suspense",
    module: "banking",
    label: "Suspense / uncategorised",
    hint: "Holds imported bank lines that no rule matched. Clear before period close.",
    defaultAccountNumber: "9999",
  },
  {
    key: "salaries_payable",
    module: "payroll",
    label: "Salaries payable",
    hint: "Credited with net pay when a pay run is posted; debited when salaries are paid out.",
    defaultAccountNumber: "2200",
  },
  {
    key: "payroll_tax_payable",
    module: "payroll",
    label: "Payroll tax payable (employer)",
    hint: "Credited with employer payroll tax (e.g. social security) owed on a pay run.",
    defaultAccountNumber: "2210",
  },
  {
    key: "income_tax_payable",
    module: "payroll",
    label: "Income tax withheld (payable)",
    hint: "Credited with income tax deducted from employee pay, pending remittance.",
    defaultAccountNumber: "2220",
  },
  {
    key: "eobi_payable",
    module: "payroll",
    label: "Pension / EOBI payable",
    hint: "Credited with combined employee and employer EOBI contributions.",
    defaultAccountNumber: "2230",
  },
  {
    key: "salaries_expense",
    module: "payroll",
    label: "Salaries & wages expense",
    hint: "Debited with gross pay (basic + allowances) for every pay run.",
    defaultAccountNumber: "6200",
  },
  {
    key: "payroll_tax_expense",
    module: "payroll",
    label: "Payroll tax expense (employer)",
    hint: "Debited with the employer's own EOBI and payroll tax contributions.",
    defaultAccountNumber: "6210",
  },
  {
    key: "inventory_asset",
    module: "inventory",
    label: "Inventory (asset)",
    hint: "Debited on receipts, credited when stock is issued, sold or written down.",
    defaultAccountNumber: "1300",
  },
  {
    key: "cogs",
    module: "inventory",
    label: "Cost of goods sold",
    hint: "Debited with the computed cost when inventory items are sold.",
    defaultAccountNumber: "5000",
  },
  {
    key: "inventory_writedown",
    module: "inventory",
    label: "Inventory write-down / shrinkage",
    hint: "Debited for write-downs and negative count adjustments; credited for positive ones.",
    defaultAccountNumber: "6600",
  },
  {
    key: "grni",
    module: "inventory",
    label: "Goods received not invoiced",
    hint: "Default credit side for manual stock receipts pending the supplier bill.",
    defaultAccountNumber: "2150",
  },
  {
    key: "retained_earnings",
    module: "close",
    label: "Retained earnings",
    hint: "Receives the net profit or loss when a fiscal year is closed.",
    defaultAccountNumber: "3200",
  },
  {
    key: "fx_gain",
    module: "fx",
    label: "Foreign exchange gain",
    hint: "Credited when a foreign-currency document settles at a favourable rate.",
    defaultAccountNumber: "7200",
  },
  {
    key: "fx_loss",
    module: "fx",
    label: "Foreign exchange loss",
    hint: "Debited when a foreign-currency document settles at an unfavourable rate.",
    defaultAccountNumber: "8200",
  },
];

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

/** All configured mappings for an entity, keyed by mapping key. */
export async function getMappings(entityId: string): Promise<Map<MappingKey, string>> {
  const rows = await db
    .select({ key: accountMappings.key, accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(eq(accountMappings.entityId, entityId));
  return new Map(rows.map((r) => [r.key as MappingKey, r.accountId]));
}

/**
 * Resolve one mapping to an account id. Falls back to the default account
 * number so a partially-configured entity still posts correctly; throws a
 * readable error if neither exists.
 */
export async function resolveMapping(
  entityId: string,
  key: MappingKey,
  cache?: Map<MappingKey, string>
): Promise<string> {
  const mapped = cache ? cache.get(key) : (await getMappings(entityId)).get(key);
  if (mapped) return mapped;

  const def = MAPPING_DEFS.find((d) => d.key === key)!;
  const rows = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.entityId, entityId),
        eq(chartOfAccounts.accountNumber, def.defaultAccountNumber)
      )
    );
  if (rows[0]) return rows[0].id;

  throw new MappingError(
    `No account mapped for "${def.label}" and default account ${def.defaultAccountNumber} does not exist. Configure it under Account Mapping.`
  );
}

/** Seed any missing mappings from the default COA. Idempotent. */
export async function seedDefaultMappings(entityId: string): Promise<number> {
  const existing = await getMappings(entityId);
  const accounts = await db
    .select({ id: chartOfAccounts.id, number: chartOfAccounts.accountNumber })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.entityId, entityId));
  const byNumber = new Map(accounts.map((a) => [a.number, a.id]));

  const toInsert = MAPPING_DEFS.flatMap((d) => {
    if (existing.has(d.key)) return [];
    const accountId = byNumber.get(d.defaultAccountNumber);
    if (!accountId) return [];
    return [{ entityId, module: d.module as string, key: d.key as string, accountId }];
  });

  if (toInsert.length === 0) return 0;
  await db.insert(accountMappings).values(toInsert).onConflictDoNothing();
  return toInsert.length;
}

export async function setMapping(
  entityId: string,
  key: MappingKey,
  accountId: string,
  userId: string
): Promise<void> {
  const def = MAPPING_DEFS.find((d) => d.key === key);
  if (!def) throw new MappingError(`Unknown mapping key: ${key}`);

  await db
    .insert(accountMappings)
    .values({ entityId, module: def.module, key, accountId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [accountMappings.entityId, accountMappings.module, accountMappings.key],
      set: { accountId, updatedAt: new Date() },
    });

  await writeAudit(db, {
    entityId,
    userId,
    action: "MAPPING_UPDATED",
    tableName: "account_mappings",
    recordId: key,
    afterState: { key, accountId },
  });
}
