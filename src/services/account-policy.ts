import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { chartOfAccounts, accountMappings } from "@/db/schema";
import { db, type Db, type Tx } from "@/db";
import { allowsBankCategory, allowsBillCoding } from "@/lib/account-policy";
import { resolveMapping } from "@/services/mappings";
import { parseCents } from "@/lib/money";

export async function assertSuspenseClear(entityId: string, asOf: string, executor: Db | Tx = db) {
  const id = await resolveMapping(entityId, "suspense");
  const [account] = await executor.select().from(chartOfAccounts).where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.entityId, entityId)));
  if (!account || account.type !== "asset" || account.subType !== "suspense") throw new Error("Review the suspense classification before closing; it must be a balance-sheet clearing account");
  const result = await executor.execute(sql`SELECT COALESCE(SUM(l.debit_base-l.credit_base),0) AS balance
    FROM journal_entry_lines l JOIN journal_entries je ON je.id=l.je_id
    WHERE l.account_id=${id} AND je.entity_id=${entityId} AND je.status IN ('posted','voided') AND je.date<=${asOf}`);
  if (parseCents((result.rows[0] as { balance: string }).balance) !== 0n) {
    throw new Error("Clear the suspense balance before closing");
  }
}

export async function assertPostingAccount(entityId: string, accountId: string,
  purpose: "bank" | "category" | "bill", executor: Db | Tx = db, allowSuspense = false) {
  const [account] = await executor.select().from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.entityId, entityId), eq(chartOfAccounts.id, accountId)));
  if (!account || !account.isActive) throw new Error("Select an active account belonging to this entity");
  const protectedMappings = await executor.select({ key: accountMappings.key }).from(accountMappings)
    .where(and(eq(accountMappings.entityId, entityId), eq(accountMappings.accountId, accountId),
      inArray(accountMappings.key, ["ar_control", "ap_control", "inventory_asset", "retained_earnings", "suspense", "sales_tax_payable", "input_tax", "salaries_payable", "income_tax_payable", "eobi_payable", "payroll_tax_payable"])));
  const isSuspense = allowSuspense && (account.subType === "suspense" || protectedMappings.some(m => m.key === "suspense"));
  const valid = purpose === "bank" ? account.type === "asset" && account.subType === "cash_and_bank" && protectedMappings.length === 0
    : isSuspense ? account.type === "asset" && account.subType === "suspense" && protectedMappings.every(m => m.key === "suspense")
    : protectedMappings.length === 0 && (purpose === "category" ? allowsBankCategory(account) : allowsBillCoding(account));
  if (!valid) throw new Error(`This account cannot be used for ${purpose === "bill" ? "bill coding" : purpose === "bank" ? "cash/bank posting" : "bank categorisation"}; use the appropriate document workflow`);
  return account;
}
