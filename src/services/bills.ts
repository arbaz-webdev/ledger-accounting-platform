import "server-only";
import Decimal from "decimal.js";
import { calculateDocumentLine } from "@/lib/document-math";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bills, billLines, contacts, chartOfAccounts, settlements } from "@/db/schema";
import { postJournalEntry } from "@/services/journal";
import { resolveMapping, getMappings } from "@/services/mappings";
import { writeAudit } from "@/services/audit";
import { assertPostingAccount } from "@/services/account-policy";
import { receiveStockInTx } from "@/services/inventory";
import { getBaseCurrency, resolveRate, toBase } from "@/services/fx";

/**
 * Purchase bills / Accounts Payable (spec section 7).
 *
 * Bill posted:
 *   DR Expense / COGS   net per line (line account)
 *   DR Inventory        net of lines that reference an inventory item
 *   DR Input Tax        tax total (if any)
 *   CR Accounts Payable gross total
 * Item lines create a stock lot (cost layer) at net/quantity, atomically with
 * the posting.
 *
 * A Purchase Order is explicitly non-posting (spec 7.1) and is not modelled here.
 * `tax_rate` is a PERCENTAGE (15 = 15%).
 */

export class BillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillError";
  }
}

export type BillLineInput = {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  expenseAccountId: string;
  taxRate?: string | number;
  /** Inventory item received on this line — debits Inventory, creates a lot. */
  itemId?: string;
};

export type CreateBillInput = {
  entityId: string;
  supplierId: string;
  supplierReference?: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  /** defaults to the entity's base currency */
  currency?: string;
  /** override the rate table; otherwise the rate ruling at the issue date */
  fxRate?: string | number;
  lines: BillLineInput[];
};

function computeLine(line: BillLineInput) {
  return calculateDocumentLine(line);
}

export async function createBillDraft(input: CreateBillInput, userId: string) {
  return db.transaction(async (tx) => {
    if (input.lines.length === 0) throw new BillError("A bill needs at least one line");

    const computed = input.lines.map(computeLine);
    const subtotal = computed.reduce((s, c) => s.plus(c.net), new Decimal(0));
    const taxTotal = computed.reduce((s, c) => s.plus(c.tax), new Decimal(0));
    const total = subtotal.plus(taxTotal);
    if (total.lessThanOrEqualTo(0)) throw new BillError("Bill total must be greater than zero");

    const baseCurrency = await getBaseCurrency(input.entityId);
    const currency = (input.currency || baseCurrency).toUpperCase();
    const fxRate =
      input.fxRate !== undefined && input.fxRate !== ""
        ? new Decimal(input.fxRate)
        : await resolveRate(input.entityId, currency, input.issueDate);
    if (fxRate.lessThanOrEqualTo(0)) throw new BillError("Exchange rate must be greater than zero");

    const numRows = await tx.execute(
      sql`SELECT next_document_number(${input.entityId}::uuid, 'bill') AS n`
    );
    const seq = Number((numRows.rows[0] as { n: string | number }).n);
    const billNumber = `BILL-${String(seq).padStart(4, "0")}`;

    const [bill] = await tx
      .insert(bills)
      .values({
        entityId: input.entityId,
        supplierId: input.supplierId,
        billNumber,
        supplierReference: input.supplierReference,
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

    await tx.insert(billLines).values(
      input.lines.map((l, i) => ({
        billId: bill.id,
        lineNo: i + 1,
        description: l.description,
        quantity: computed[i].qty.toString(),
        unitPrice: computed[i].price.toString(),
        expenseAccountId: l.expenseAccountId,
        taxRate: computed[i].rate.toString(),
        netAmount: computed[i].net.toFixed(2),
        taxAmount: computed[i].tax.toFixed(2),
        itemId: l.itemId || undefined,
      }))
    );

    await writeAudit(tx, {
      entityId: input.entityId,
      userId,
      action: "BILL_CREATED",
      tableName: "bills",
      recordId: bill.id,
      afterState: { billNumber, total: total.toFixed(2) },
    });

    return bill;
  });
}

export async function postBill(billId: string, entityId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(bills)
      .where(and(eq(bills.id, billId), eq(bills.entityId, entityId))).for("update");
    if (!bill) throw new BillError("Bill not found");
    if (bill.status !== "draft") {
      throw new BillError(`Only draft bills can be posted (this one is ${bill.status})`);
    }

    const lines = await tx.select().from(billLines).where(eq(billLines.billId, billId));
    for (const line of lines.filter(l => !l.itemId)) {
      await assertPostingAccount(entityId, line.expenseAccountId, "bill", tx);
    }
    const [supplier] = await tx
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, bill.supplierId));

    const cache = await getMappings(entityId);
    const apAccount = await resolveMapping(entityId, "ap_control", cache);
    const inputTaxAccount = await resolveMapping(entityId, "input_tax", cache);

    // Item lines debit Inventory (creating a cost layer); the rest debit their
    // chosen expense account.
    const itemLines = lines.filter((l) => l.itemId);
    const expenseByAccount = new Map<string, Decimal>();
    let inventoryTotal = new Decimal(0);
    for (const l of lines) {
      if (l.itemId) {
        inventoryTotal = inventoryTotal.plus(new Decimal(l.netAmount));
        continue;
      }
      const prev = expenseByAccount.get(l.expenseAccountId) ?? new Decimal(0);
      expenseByAccount.set(l.expenseAccountId, prev.plus(new Decimal(l.netAmount)));
    }
    const taxTotal = new Decimal(bill.taxTotal);

    // Every line of a bill is denominated in the bill's currency; the ledger
    // records both the transaction amount and the base amount.
    const fx = { currency: bill.currency, fxRate: bill.fxRate };
    const jeLines: {
      accountId: string;
      description?: string;
      debit?: string;
      credit?: string;
      currency?: string;
      fxRate?: string;
    }[] = [];
    for (const [accountId, amount] of expenseByAccount) {
      if (amount.isZero()) continue;
      jeLines.push({ accountId, debit: amount.toFixed(2), ...fx });
    }
    if (inventoryTotal.greaterThan(0)) {
      const inventoryAccount = await resolveMapping(entityId, "inventory_asset", cache);
      jeLines.push({
        accountId: inventoryAccount,
        description: "Stock received",
        debit: inventoryTotal.toFixed(2),
        ...fx,
      });
    }
    if (taxTotal.greaterThan(0)) {
      jeLines.push({ accountId: inputTaxAccount, description: "Input tax", debit: taxTotal.toFixed(2), ...fx });
    }
    jeLines.push({
      accountId: apAccount,
      description: `${bill.billNumber} — ${supplier?.name ?? ""}`,
      credit: bill.total,
      ...fx,
    });


      const { jeId, jeNumber } = await postJournalEntry(
        {
          entityId,
          date: bill.issueDate,
          description: `Bill ${bill.billNumber} — ${supplier?.name ?? "supplier"}`,
          reference: bill.supplierReference || bill.billNumber,
          sourceModule: "bill",
          lines: jeLines,
        },
        userId,
        tx
      );

      // One lot per item line, at that line's actual unit cost (net / qty).
      // Inventory is a base-currency asset, so foreign-currency bills convert at
      // the bill's rate — the lot value then matches what hit the GL exactly.
      for (const l of itemLines) {
        const qty = new Decimal(l.quantity);
        if (qty.lessThanOrEqualTo(0)) continue;
        const netBase = toBase(l.netAmount, bill.fxRate);
        const unitCost = netBase.dividedBy(qty).toDecimalPlaces(6);
        await receiveStockInTx(
          tx,
          {
            entityId,
            itemId: l.itemId!,
            kind: "receipt",
            date: bill.issueDate,
            quantity: qty,
            unitCost,
            totalCostOverride: netBase,
            jeId,
            billId,
            reference: bill.billNumber,
          },
          userId
        );
      }

      await tx
        .update(bills)
        .set({ status: "posted", jeId, postedAt: new Date() })
        .where(eq(bills.id, billId));

      await writeAudit(tx, {
        entityId,
        userId,
        action: "BILL_POSTED",
        tableName: "bills",
        recordId: billId,
        afterState: {
          billNumber: bill.billNumber,
          jeNumber,
          total: bill.total,
          ...(inventoryTotal.greaterThan(0) ? { stockReceived: inventoryTotal.toFixed(2) } : {}),
        },
      });

      return { jeId, jeNumber };

  });
}

export async function deleteBillDraft(billId: string, entityId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(bills)
      .where(and(eq(bills.id, billId), eq(bills.entityId, entityId)));
    if (!bill) throw new BillError("Bill not found");
    if (bill.status !== "draft") throw new BillError("Only draft bills can be discarded");

    await writeAudit(tx, {
      entityId,
      userId,
      action: "BILL_DISCARDED",
      tableName: "bills",
      recordId: billId,
      beforeState: { billNumber: bill.billNumber },
    });
    await tx.delete(bills).where(eq(bills.id, billId));
  });
}

export async function listBills(entityId: string) {
  const rows = await db.execute(sql`
    SELECT b.id, b.bill_number, b.supplier_reference, b.issue_date, b.due_date, b.status, b.total,
           c.name AS supplier_name,
           COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.bill_id = b.id), 0) AS settled
    FROM bills b
    JOIN contacts c ON c.id = b.supplier_id
    WHERE b.entity_id = ${entityId}
    ORDER BY b.created_at DESC
    LIMIT 200
  `);
  return (
    rows.rows as {
      id: string;
      bill_number: string;
      supplier_reference: string | null;
      issue_date: string;
      due_date: string;
      status: string;
      total: string;
      supplier_name: string;
      settled: string;
    }[]
  ).map((r) => ({
    id: r.id,
    billNumber: r.bill_number,
    supplierReference: r.supplier_reference,
    issueDate: String(r.issue_date).slice(0, 10),
    dueDate: String(r.due_date).slice(0, 10),
    status: r.status,
    supplierName: r.supplier_name,
    total: r.total,
    settled: r.settled,
    outstanding: new Decimal(r.total).minus(new Decimal(r.settled)).toFixed(2),
  }));
}

export async function getBill(billId: string, entityId: string) {
  const [bill] = await db
    .select()
    .from(bills)
    .where(and(eq(bills.id, billId), eq(bills.entityId, entityId)));
  if (!bill) return null;

  const [supplier] = await db.select().from(contacts).where(eq(contacts.id, bill.supplierId));

  const lines = await db
    .select({
      lineNo: billLines.lineNo,
      description: billLines.description,
      quantity: billLines.quantity,
      unitPrice: billLines.unitPrice,
      taxRate: billLines.taxRate,
      netAmount: billLines.netAmount,
      taxAmount: billLines.taxAmount,
      accountNumber: chartOfAccounts.accountNumber,
      accountName: chartOfAccounts.name,
    })
    .from(billLines)
    .innerJoin(chartOfAccounts, eq(billLines.expenseAccountId, chartOfAccounts.id))
    .where(eq(billLines.billId, billId))
    .orderBy(billLines.lineNo);

  const settlementRows = await db
    .select()
    .from(settlements)
    .where(eq(settlements.billId, billId))
    .orderBy(desc(settlements.date));

  const settled = settlementRows.reduce((s, r) => s.plus(new Decimal(r.amount)), new Decimal(0));
  const outstanding = new Decimal(bill.total).minus(settled);

  return {
    bill,
    supplier,
    lines,
    settlements: settlementRows,
    settled: settled.toFixed(2),
    outstanding: outstanding.toFixed(2),
  };
}
