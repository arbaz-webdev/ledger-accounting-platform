import "server-only";
import Decimal from "decimal.js";
import { calculateDocumentLine } from "@/lib/document-math";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, invoiceLines, contacts, chartOfAccounts, settlements, inventoryItems, inventoryMovements, businessSettings } from "@/db/schema";
import { postJournalEntry, voidJournalEntry } from "@/services/journal";
import { resolveMapping, getMappings } from "@/services/mappings";
import { writeAudit } from "@/services/audit";
import {
  planConsumptionInTx,
  recordPlannedConsumptionInTx,
  type ConsumptionPlan,
} from "@/services/inventory";
import { getBaseCurrency, resolveRate } from "@/services/fx";

/**
 * Invoicing / Accounts Receivable (spec section 6).
 *
 * Invoice posted (sale on credit) — spec 4.2 example:
 *   DR Accounts Receivable  gross total
 *   CR Sales Revenue        net per line (line account, else mapped default)
 *   CR Sales Tax Payable    tax total
 * Lines that reference an inventory item additionally post, in the SAME JE:
 *   DR Cost of Goods Sold   computed cost (item's costing method)
 *   CR Inventory            computed cost
 * and consume stock lots atomically with the posting.
 *
 * `tax_rate` is a PERCENTAGE (15 = 15%).
 */

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

export type InvoiceLineInput = {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  revenueAccountId: string;
  taxRate?: string | number;
  /** Inventory item sold on this line — triggers COGS posting + stock issue. */
  itemId?: string;
};

export type CreateInvoiceInput = {
  entityId: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  /** defaults to the entity's base currency */
  currency?: string;
  /** override the rate table; otherwise the rate ruling at the issue date */
  fxRate?: string | number;
  lines: InvoiceLineInput[];
};

function computeLine(line: InvoiceLineInput) {
  return calculateDocumentLine(line);
}

/** Create a draft invoice with a generated number. No ledger impact. */
export async function createInvoiceDraft(input: CreateInvoiceInput, userId: string) {
  return db.transaction(async (tx) => {
    if (input.lines.length === 0) throw new InvoiceError("An invoice needs at least one line");

    const computed = input.lines.map(computeLine);
    const subtotal = computed.reduce((s, c) => s.plus(c.net), new Decimal(0));
    const taxTotal = computed.reduce((s, c) => s.plus(c.tax), new Decimal(0));
    const total = subtotal.plus(taxTotal);
    if (total.lessThanOrEqualTo(0)) throw new InvoiceError("Invoice total must be greater than zero");

    const baseCurrency = await getBaseCurrency(input.entityId);
    const currency = (input.currency || baseCurrency).toUpperCase();
    const fxRate =
      input.fxRate !== undefined && input.fxRate !== ""
        ? new Decimal(input.fxRate)
        : await resolveRate(input.entityId, currency, input.issueDate);
    if (fxRate.lessThanOrEqualTo(0)) throw new InvoiceError("Exchange rate must be greater than zero");

    const numRows = await tx.execute(
      sql`SELECT next_document_number(${input.entityId}::uuid, 'invoice') AS n`
    );
    const seq = Number((numRows.rows[0] as { n: string | number }).n);
    const [numbering] = await tx.select({ prefix: businessSettings.invoicePrefix }).from(businessSettings).where(eq(businessSettings.entityId, input.entityId));
    const invoiceNumber = `${numbering?.prefix ?? "INV"}-${String(seq).padStart(4, "0")}`;

    const [invoice] = await tx
      .insert(invoices)
      .values({
        entityId: input.entityId,
        customerId: input.customerId,
        invoiceNumber,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        notes: input.notes,
        currency,
        fxRate: fxRate.toString(),
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: total.toFixed(2),
        createdBy: userId,
      })
      .returning();

    await tx.insert(invoiceLines).values(
      input.lines.map((l, i) => ({
        invoiceId: invoice.id,
        lineNo: i + 1,
        description: l.description,
        quantity: computed[i].qty.toString(),
        unitPrice: computed[i].price.toString(),
        revenueAccountId: l.revenueAccountId,
        taxRate: computed[i].rate.toString(),
        netAmount: computed[i].net.toFixed(2),
        taxAmount: computed[i].tax.toFixed(2),
        itemId: l.itemId || undefined,
      }))
    );

    await writeAudit(tx, {
      entityId: input.entityId,
      userId,
      action: "INVOICE_CREATED",
      tableName: "invoices",
      recordId: invoice.id,
      afterState: { invoiceNumber, total: total.toFixed(2) },
    });

    return invoice;
  });
}

/** Post a draft invoice to the ledger (spec 6.1). */
export async function postInvoice(invoiceId: string, entityId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.entityId, entityId))).for("update");
    if (!invoice) throw new InvoiceError("Invoice not found");
    if (invoice.status !== "draft") {
      throw new InvoiceError(`Only draft invoices can be posted (this one is ${invoice.status})`);
    }

    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    const [customer] = await tx
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, invoice.customerId));

    const cache = await getMappings(entityId);
    const arAccount = await resolveMapping(entityId, "ar_control", cache);
    const taxAccount = await resolveMapping(entityId, "sales_tax_payable", cache);

    // Credit revenue grouped by account so the JE stays compact
    const revenueByAccount = new Map<string, Decimal>();
    for (const l of lines) {
      const prev = revenueByAccount.get(l.revenueAccountId) ?? new Decimal(0);
      revenueByAccount.set(l.revenueAccountId, prev.plus(new Decimal(l.netAmount)));
    }
    const taxTotal = new Decimal(invoice.taxTotal);

    // Service catalog lines carry a price but never consume stock.
    const itemIds = [...new Set(lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
    const catalog = itemIds.length ? await tx.select({ id: inventoryItems.id, isService: inventoryItems.isService })
      .from(inventoryItems).where(and(eq(inventoryItems.entityId, entityId), inArray(inventoryItems.id, itemIds))) : [];
    if (catalog.length !== itemIds.length) throw new InvoiceError("One or more items do not belong to this business");
    const serviceIds = new Set(catalog.filter((item) => item.isService).map((item) => item.id));
    // Inventory lines: total quantity sold per item
    const qtyByItem = new Map<string, Decimal>();
    for (const l of lines) {
      if (!l.itemId || serviceIds.has(l.itemId)) continue;
      const prev = qtyByItem.get(l.itemId) ?? new Decimal(0);
      qtyByItem.set(l.itemId, prev.plus(new Decimal(l.quantity)));
    }


      // Plan stock consumption first (locks lots): COGS must be known before
      // the JE lines can be built. Throws on insufficient stock.
      const plans = new Map<string, ConsumptionPlan>();
      let cogsTotal = new Decimal(0);
      for (const [itemId, qty] of qtyByItem) {
        const { plan } = await planConsumptionInTx(tx, entityId, itemId, qty);
        plans.set(itemId, plan);
        cogsTotal = cogsTotal.plus(plan.totalCost);
      }

      // Document-currency lines carry the invoice's currency + rate; the ledger
      // stores both the transaction amount and the base amount (debit_base).
      const fx = { currency: invoice.currency, fxRate: invoice.fxRate };
      const jeLines: {
        accountId: string;
        description?: string;
        debit?: string;
        credit?: string;
        currency?: string;
        fxRate?: string;
      }[] = [
        {
          accountId: arAccount,
          description: `${invoice.invoiceNumber} — ${customer?.name ?? ""}`,
          debit: invoice.total,
          ...fx,
        },
      ];
      for (const [accountId, amount] of revenueByAccount) {
        if (amount.isZero()) continue;
        jeLines.push({ accountId, credit: amount.toFixed(2), ...fx });
      }
      if (taxTotal.greaterThan(0)) {
        jeLines.push({ accountId: taxAccount, description: "Sales tax", credit: taxTotal.toFixed(2), ...fx });
      }
      if (cogsTotal.greaterThan(0)) {
        const cogsAccount = await resolveMapping(entityId, "cogs", cache);
        const inventoryAccount = await resolveMapping(entityId, "inventory_asset", cache);
        jeLines.push({ accountId: cogsAccount, description: "Cost of goods sold", debit: cogsTotal.toFixed(2) });
        jeLines.push({ accountId: inventoryAccount, description: "Inventory issued", credit: cogsTotal.toFixed(2) });
      }

      const { jeId, jeNumber } = await postJournalEntry(
        {
          entityId,
          date: invoice.issueDate,
          description: `Invoice ${invoice.invoiceNumber} — ${customer?.name ?? "customer"}`,
          reference: invoice.invoiceNumber,
          sourceModule: "invoice",
          lines: jeLines,
        },
        userId,
        tx
      );

      // Record the planned consumption against the same JE
      for (const [itemId, qty] of qtyByItem) {
        await recordPlannedConsumptionInTx(
          tx,
          {
            entityId,
            itemId,
            date: invoice.issueDate,
            quantity: qty,
            plan: plans.get(itemId)!,
            jeId,
            invoiceId,
            reference: invoice.invoiceNumber,
          },
          userId
        );
      }

      await tx
        .update(invoices)
        .set({ status: "posted", jeId, postedAt: new Date() })
        .where(eq(invoices.id, invoiceId));

      await writeAudit(tx, {
        entityId,
        userId,
        action: "INVOICE_POSTED",
        tableName: "invoices",
        recordId: invoiceId,
        afterState: {
          invoiceNumber: invoice.invoiceNumber,
          jeNumber,
          total: invoice.total,
          ...(cogsTotal.greaterThan(0) ? { cogs: cogsTotal.toFixed(2) } : {}),
        },
      });

      return { jeId, jeNumber };

  });
}

export async function deleteInvoiceDraft(invoiceId: string, entityId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.entityId, entityId)));
    if (!invoice) throw new InvoiceError("Invoice not found");
    if (invoice.status !== "draft") {
      throw new InvoiceError("Only draft invoices can be discarded");
    }
    await writeAudit(tx, {
      entityId,
      userId,
      action: "INVOICE_DISCARDED",
      tableName: "invoices",
      recordId: invoiceId,
      beforeState: { invoiceNumber: invoice.invoiceNumber },
    });
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
  });
}

/** Preserve the document and its original posting; reverse it in an open period. */
export async function voidInvoice(invoiceId: string, entityId: string, userId: string, voidDate: string) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.entityId, entityId))).for("update");
    if (!invoice || !invoice.jeId) throw new InvoiceError("Posted invoice not found");
    if (invoice.status !== "posted") throw new InvoiceError("Only an open posted invoice can be voided");
    const linked = await tx.select({ id: settlements.id }).from(settlements).where(eq(settlements.invoiceId, invoiceId)).limit(1);
    if (linked.length) throw new InvoiceError("Unapply settlements before voiding this invoice");
    const stock = await tx.select({ id: inventoryMovements.id }).from(inventoryMovements).where(eq(inventoryMovements.invoiceId, invoiceId)).limit(1);
    if (stock.length) throw new InvoiceError("Inventory invoices need stock reversal before voiding");
    const reversal = await voidJournalEntry(invoice.jeId, entityId, userId, voidDate, tx, "invoice");
    await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, invoiceId));
    await writeAudit(tx, { entityId, userId, action: "INVOICE_VOIDED", tableName: "invoices", recordId: invoiceId,
      beforeState: { status: invoice.status }, afterState: { status: "void", reversalJeId: reversal.reversalJeId, voidDate } });
    return reversal;
  });
}

export async function updateInvoiceMetadata(invoiceId: string, entityId: string, userId: string, input: {
  dueDate: string; notes: string; purchaseOrderReference: string;
}) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.entityId, entityId))).for("update");
    if (!invoice || invoice.status === "void") throw new InvoiceError("Editable invoice not found");
    const parsed = new Date(`${input.dueDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.dueDate || input.dueDate < invoice.issueDate) {
      throw new InvoiceError("Due date must be a valid date on or after the issue date");
    }
    const after = { dueDate: input.dueDate, notes: input.notes.trim().slice(0, 4000), purchaseOrderReference: input.purchaseOrderReference.trim().slice(0, 160) };
    await tx.update(invoices).set(after).where(eq(invoices.id, invoiceId));
    await writeAudit(tx, { entityId, userId, action: "INVOICE_METADATA_UPDATED", tableName: "invoices", recordId: invoiceId,
      beforeState: { dueDate: invoice.dueDate, notes: invoice.notes, purchaseOrderReference: invoice.purchaseOrderReference }, afterState: after });
  });
}

/** Invoice list with live outstanding balance. */
export async function listInvoices(entityId: string) {
  const rows = await db.execute(sql`
    SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.status, i.total,
           c.name AS customer_name,
           COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.invoice_id = i.id), 0) AS settled
    FROM invoices i
    JOIN contacts c ON c.id = i.customer_id
    WHERE i.entity_id = ${entityId}
    ORDER BY i.created_at DESC
    LIMIT 200
  `);
  return (
    rows.rows as {
      id: string;
      invoice_number: string;
      issue_date: string;
      due_date: string;
      status: string;
      total: string;
      customer_name: string;
      settled: string;
    }[]
  ).map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    issueDate: String(r.issue_date).slice(0, 10),
    dueDate: String(r.due_date).slice(0, 10),
    status: r.status,
    customerName: r.customer_name,
    total: r.total,
    settled: r.settled,
    outstanding: r.status === "void" ? "0.00" : new Decimal(r.total).minus(new Decimal(r.settled)).toFixed(2),
  }));
}

export async function getInvoice(invoiceId: string, entityId: string) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.entityId, entityId)));
  if (!invoice) return null;

  const [customer] = await db.select().from(contacts).where(eq(contacts.id, invoice.customerId));

  const lines = await db
    .select({
      lineNo: invoiceLines.lineNo,
      description: invoiceLines.description,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      taxRate: invoiceLines.taxRate,
      netAmount: invoiceLines.netAmount,
      taxAmount: invoiceLines.taxAmount,
      itemId: invoiceLines.itemId,
      itemIsService: inventoryItems.isService,
      accountNumber: chartOfAccounts.accountNumber,
      accountName: chartOfAccounts.name,
    })
    .from(invoiceLines)
    .innerJoin(chartOfAccounts, eq(invoiceLines.revenueAccountId, chartOfAccounts.id))
    .leftJoin(inventoryItems, eq(invoiceLines.itemId, inventoryItems.id))
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(invoiceLines.lineNo);

  const settlementRows = await db
    .select()
    .from(settlements)
    .where(eq(settlements.invoiceId, invoiceId))
    .orderBy(desc(settlements.date));

  const settled = settlementRows.reduce((s, r) => s.plus(new Decimal(r.amount)), new Decimal(0));
  const outstanding = invoice.status === "void" ? new Decimal(0) : new Decimal(invoice.total).minus(settled);

  return {
    invoice,
    customer,
    lines,
    settlements: settlementRows,
    settled: settled.toFixed(2),
    outstanding: outstanding.toFixed(2),
  };
}
