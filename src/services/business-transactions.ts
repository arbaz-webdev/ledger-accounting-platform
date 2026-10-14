import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chartOfAccounts } from "@/db/schema";
import { postJournalEntry } from "@/services/journal";

export type QuickTransactionKind = "transfer" | "deposit" | "expense" | "receipt";

export async function postQuickTransaction(input: {
  entityId: string; kind: QuickTransactionKind; date: string; description: string;
  bankAccountId: string; counterAccountId: string; amount: string; reference?: string;
}, userId: string) {
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || !amount.isPositive() || amount.decimalPlaces() > 2) throw new Error("Enter a positive amount with at most two decimals");
  if (!input.description.trim()) throw new Error("Description is required");
  if (input.bankAccountId === input.counterAccountId) throw new Error("Choose two different accounts");
  const accounts = await db.select({ id: chartOfAccounts.id, type: chartOfAccounts.type, subType: chartOfAccounts.subType,
    isActive: chartOfAccounts.isActive }).from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.entityId, input.entityId), inArray(chartOfAccounts.id, [input.bankAccountId,input.counterAccountId])));
  const bank = accounts.find(a => a.id === input.bankAccountId);
  const counter = accounts.find(a => a.id === input.counterAccountId);
  if (!bank?.isActive || bank.type !== "asset" || bank.subType !== "cash_and_bank" || !counter?.isActive) throw new Error("Select active accounts for this business");
  if (input.kind === "transfer" && !(counter.type === "asset" && counter.subType === "cash_and_bank")) throw new Error("Choose another cash or bank account for a transfer");
  if (input.kind === "expense" && !["expense","other_expense","cogs"].includes(counter.type)) throw new Error("Choose an expense account");
  if (input.kind === "receipt" && !["revenue","other_income"].includes(counter.type)) throw new Error("Choose an income account; customer invoice receipts belong on the invoice");
  if (input.kind === "deposit" && !["liability","equity","revenue","other_income"].includes(counter.type)) throw new Error("Choose the source of this deposit");
  if (!["transfer","expense","receipt","deposit"].includes(input.kind)) throw new Error("Invalid transaction type");
  const money = amount.toFixed(2);
  const bankIsDebit = input.kind === "receipt" || input.kind === "deposit";
  return postJournalEntry({ entityId: input.entityId, date: input.date,
    description: `${input.kind.toUpperCase()}: ${input.description.trim()}`,
    reference: input.reference?.trim() || undefined, sourceModule: "manual",
    lines: [
      { accountId: input.bankAccountId, ...(bankIsDebit ? { debit: money } : { credit: money }) },
      { accountId: input.counterAccountId, ...(bankIsDebit ? { credit: money } : { debit: money }) },
    ] }, userId);
}
