import "server-only";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, bills, settlements, contacts } from "@/db/schema";
import { postJournalEntry } from "@/services/journal";
import { resolveMapping, getMappings, type MappingKey } from "@/services/mappings";
import { resolveRate, toBase } from "@/services/fx";
import { writeAudit } from "@/services/audit";

/**
 * Settlements — anything that reduces an open invoice or bill balance
 * (spec 6.1 and 7.1 event tables). Each posts its own journal entry:
 *
 *   Invoice payment      DR Bank              CR Accounts Receivable
 *   Invoice credit note  DR Sales Discounts   CR Accounts Receivable
 *   Invoice write-off    DR Bad Debt Expense  CR Accounts Receivable
 *   Bill payment         DR Accounts Payable  CR Bank
 *   Bill credit note     DR Accounts Payable  CR Purchase Discounts
 */

export type SettlementKind = "payment" | "credit_note" | "write_off";

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

export type RecordSettlementInput = {
  entityId: string;
  kind: SettlementKind;
  invoiceId?: string;
  billId?: string;
  date: string;
  /** in the DOCUMENT's currency */
  amount: string | number;
  bankAccountId?: string;
  reference?: string;
  /** payments only: rate on the settlement date; defaults to the rate table */
  fxRate?: string | number;
};

export async function recordSettlement(input: RecordSettlementInput, userId: string) {
  const amount = new Decimal(input.amount || 0);
  if (amount.lessThanOrEqualTo(0)) throw new SettlementError("Amount must be greater than zero");
  if (amount.decimalPlaces() > 2) throw new SettlementError("Amount cannot exceed 2 decimal places");
  if (!input.invoiceId === !input.billId) {
    throw new SettlementError("A settlement must target exactly one invoice or bill");
  }
  if (input.kind === "payment" && !input.bankAccountId) {
    throw new SettlementError("Select the bank account the money moved through");
  }
  if (input.kind === "write_off" && input.billId) {
    throw new SettlementError("Write-offs apply to customer invoices only");
  }

  const isInvoice = Boolean(input.invoiceId);

  // Load the document and its current outstanding balance
  const doc = isInvoice
    ? (
        await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, input.invoiceId!), eq(invoices.entityId, input.entityId)))
      )[0]
    : (
        await db
          .select()
          .from(bills)
          .where(and(eq(bills.id, input.billId!), eq(bills.entityId, input.entityId)))
      )[0];
  if (!doc) throw new SettlementError("Document not found");
  if (doc.status === "draft") {
    throw new SettlementError("Post the document before settling it");
  }
  if (doc.status === "void") throw new SettlementError("This document has been voided");

  const settledRows = await db.execute(
    isInvoice
      ? sql`SELECT COALESCE(SUM(amount), 0) AS total FROM settlements WHERE invoice_id = ${input.invoiceId}`
      : sql`SELECT COALESCE(SUM(amount), 0) AS total FROM settlements WHERE bill_id = ${input.billId}`
  );
  const alreadySettled = new Decimal((settledRows.rows[0] as { total: string }).total);
  const outstanding = new Decimal(doc.total).minus(alreadySettled);

  if (amount.greaterThan(outstanding)) {
    throw new SettlementError(
      `Amount exceeds the outstanding balance of ${outstanding.toFixed(2)}`
    );
  }

  // Counterparty name for the JE narrative
  const contactId = isInvoice
    ? (doc as typeof invoices.$inferSelect).customerId
    : (doc as typeof bills.$inferSelect).supplierId;
  const [contact] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, contactId));

  const docNumber = isInvoice
    ? (doc as typeof invoices.$inferSelect).invoiceNumber
    : (doc as typeof bills.$inferSelect).billNumber;

  // Resolve the accounts for this event type
  const cache = await getMappings(input.entityId);
  const control = await resolveMapping(input.entityId, isInvoice ? "ar_control" : "ap_control", cache);

  let counterAccount: string;
  let narrative: string;
  if (input.kind === "payment") {
    counterAccount = input.bankAccountId!;
    narrative = isInvoice
      ? `Receipt for ${docNumber} — ${contact?.name ?? ""}`
      : `Payment for ${docNumber} — ${contact?.name ?? ""}`;
  } else if (input.kind === "credit_note") {
    const key: MappingKey = isInvoice ? "sales_discounts" : "purchase_discounts";
    counterAccount = await resolveMapping(input.entityId, key, cache);
    narrative = `Credit note against ${docNumber} — ${contact?.name ?? ""}`;
  } else {
    counterAccount = await resolveMapping(input.entityId, "bad_debt_expense", cache);
    narrative = `Bad debt write-off of ${docNumber} — ${contact?.name ?? ""}`;
  }

  // ---------------------------------------------------------------------
  // Foreign exchange. The control account was loaded at the DOCUMENT's rate,
  // so it must be relieved at that same rate; cash moves at the settlement
  // rate. Any base-currency difference is a REALISED gain or loss — that plug
  // is exactly what keeps the control account tied to the subledger.
  // Credit notes and write-offs move no cash, so they use the document rate on
  // both sides and produce no FX difference.
  // ---------------------------------------------------------------------
  const docCurrency = doc.currency;
  const docRate = new Decimal(doc.fxRate);
  const isPayment = input.kind === "payment";
  const settleRate =
    isPayment && input.fxRate !== undefined && input.fxRate !== ""
      ? new Decimal(input.fxRate)
      : isPayment
        ? await resolveRate(input.entityId, docCurrency, input.date)
        : docRate;
  if (settleRate.lessThanOrEqualTo(0)) {
    throw new SettlementError("Exchange rate must be greater than zero");
  }

  const docFx = { currency: docCurrency, fxRate: docRate.toString() };
  const settleFx = { currency: docCurrency, fxRate: settleRate.toString() };

  // Invoice settlements credit AR; bill settlements debit AP.
  const jeLines: {
    accountId: string;
    description?: string;
    debit?: string;
    credit?: string;
    currency?: string;
    fxRate?: string;
  }[] = isInvoice
    ? [
        { accountId: counterAccount, debit: amount.toFixed(2), ...(isPayment ? settleFx : docFx) },
        { accountId: control, credit: amount.toFixed(2), ...docFx },
      ]
    : [
        { accountId: control, debit: amount.toFixed(2), ...docFx },
        { accountId: counterAccount, credit: amount.toFixed(2), ...(isPayment ? settleFx : docFx) },
      ];

  // Plug the base-currency gap: more base debited than credited is a gain.
  const baseDebits = jeLines
    .filter((l) => l.debit)
    .reduce((s, l) => s.plus(toBase(l.debit!, l.fxRate!)), new Decimal(0));
  const baseCredits = jeLines
    .filter((l) => l.credit)
    .reduce((s, l) => s.plus(toBase(l.credit!, l.fxRate!)), new Decimal(0));
  const fxDelta = baseDebits.minus(baseCredits);

  if (!fxDelta.isZero()) {
    const isGain = fxDelta.greaterThan(0);
    const fxAccount = await resolveMapping(input.entityId, isGain ? "fx_gain" : "fx_loss", cache);
    jeLines.push({
      accountId: fxAccount,
      // ASCII only: text bound for the database must survive non-UTF8 clusters
      // (the local dev cluster is WIN1252, which has no "→").
      description: `Realised FX on ${docNumber} (${docCurrency} ${docRate.toString()} -> ${settleRate.toString()})`,
      ...(isGain ? { credit: fxDelta.toFixed(2) } : { debit: fxDelta.abs().toFixed(2) }),
    });
  }

  const { jeId, jeNumber } = await postJournalEntry(
    {
      entityId: input.entityId,
      date: input.date,
      description: narrative,
      reference: input.reference || docNumber,
      sourceModule: isInvoice ? "invoice" : "bill",
      lines: jeLines,
    },
    userId
  );

  const [settlement] = await db
    .insert(settlements)
    .values({
      entityId: input.entityId,
      kind: input.kind,
      invoiceId: input.invoiceId ?? null,
      billId: input.billId ?? null,
      date: input.date,
      amount: amount.toFixed(2),
      bankAccountId: input.kind === "payment" ? input.bankAccountId! : null,
      reference: input.reference,
      fxRate: settleRate.toString(),
      fxDifference: fxDelta.toFixed(2),
      jeId,
      createdBy: userId,
    })
    .returning();

  // Fully settled? mark the document paid
  const newOutstanding = outstanding.minus(amount);
  if (newOutstanding.lessThanOrEqualTo(0)) {
    if (isInvoice) {
      await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, input.invoiceId!));
    } else {
      await db.update(bills).set({ status: "paid" }).where(eq(bills.id, input.billId!));
    }
  }

  await writeAudit(db, {
    entityId: input.entityId,
    userId,
    action: `SETTLEMENT_${input.kind.toUpperCase()}`,
    tableName: "settlements",
    recordId: settlement.id,
    afterState: {
      document: docNumber,
      amount: amount.toFixed(2),
      currency: docCurrency,
      jeNumber,
      outstandingAfter: newOutstanding.toFixed(2),
      ...(fxDelta.isZero() ? {} : { realisedFx: fxDelta.toFixed(2) }),
    },
  });

  return { settlementId: settlement.id, jeId, jeNumber, realisedFx: fxDelta.toFixed(2) };
}
