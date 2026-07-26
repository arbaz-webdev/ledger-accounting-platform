import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, withTransaction, type Tx } from "@/db";
import {
  inventoryItems,
  inventoryLots,
  inventoryMovements,
  inventoryMovementLots,
  chartOfAccounts,
} from "@/db/schema";
import { postJournalEntry } from "@/services/journal";
import { resolveMapping } from "@/services/mappings";
import { writeAudit } from "@/services/audit";

/**
 * Inventory (Phase 6): item master, cost layers (lots), stock movements.
 *
 * Costing method is per item — FIFO, AVCO (weighted average) or specific
 * identification. All three share one lot ledger:
 *   * every receipt creates a lot carrying `qty_remaining` + `cost_remaining`;
 *   * every outbound movement consumes lots and reduces both columns;
 *   * a lot whose quantity hits zero always ends with cost_remaining = 0, so
 *     SUM(cost_remaining) over open lots is the exact subledger value and ties
 *     to the GL inventory account at all times.
 *
 * Consumption cost by method:
 *   FIFO      cost of the actual layers consumed, oldest first.
 *   AVCO      qty x (total value on hand / total qty on hand); lots are still
 *             drained oldest-first for bookkeeping, and the cost delta between
 *             a drained lot's value and its AVCO share rolls into the next
 *             open lot, keeping the sum invariant exact.
 *   SPECIFIC  caller names lots and quantities; each lot's own cost is used.
 *
 * Negative stock is BLOCKED: issues beyond on-hand quantity throw.
 * Movements are append-only; corrections are new movements (DB trigger).
 * Every movement posts its ledger entry through postJournalEntry inside the
 * SAME transaction that adjusts the lots — subledger and GL cannot diverge.
 */

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

// ---------------------------------------------------------------------------
// Item master
// ---------------------------------------------------------------------------

export type CostingMethod = "fifo" | "avco" | "specific";

export type ItemInput = {
  entityId: string;
  sku: string;
  name: string;
  description?: string;
  costingMethod: CostingMethod;
  unit?: string;
  salesPrice?: string | number;
};

export async function createItem(input: ItemInput, userId: string) {
  if (!input.sku.trim()) throw new InventoryError("SKU is required");
  if (!input.name.trim()) throw new InventoryError("Item name is required");

  const [item] = await db
    .insert(inventoryItems)
    .values({
      entityId: input.entityId,
      sku: input.sku.trim(),
      name: input.name.trim(),
      description: input.description || undefined,
      costingMethod: input.costingMethod,
      unit: input.unit?.trim() || "unit",
      salesPrice: String(input.salesPrice || 0),
      createdBy: userId,
    })
    .returning();

  await writeAudit(db, {
    entityId: input.entityId,
    userId,
    action: "ITEM_CREATED",
    tableName: "inventory_items",
    recordId: item.id,
    afterState: { sku: item.sku, name: item.name, costingMethod: item.costingMethod },
  });

  return item;
}

export async function updateItem(
  itemId: string,
  entityId: string,
  input: Omit<ItemInput, "entityId" | "costingMethod">,
  userId: string
) {
  const [existing] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.entityId, entityId)));
  if (!existing) throw new InventoryError("Item not found");
  if (!input.sku.trim()) throw new InventoryError("SKU is required");
  if (!input.name.trim()) throw new InventoryError("Item name is required");

  // Costing method is deliberately NOT editable: switching methods mid-life
  // rewrites the meaning of existing layers. Create a new item instead.
  await db
    .update(inventoryItems)
    .set({
      sku: input.sku.trim(),
      name: input.name.trim(),
      description: input.description || null,
      unit: input.unit?.trim() || "unit",
      salesPrice: String(input.salesPrice || 0),
    })
    .where(eq(inventoryItems.id, itemId));

  await writeAudit(db, {
    entityId,
    userId,
    action: "ITEM_UPDATED",
    tableName: "inventory_items",
    recordId: itemId,
    beforeState: { sku: existing.sku, name: existing.name },
    afterState: { sku: input.sku, name: input.name },
  });
}

export async function setItemActive(
  itemId: string,
  entityId: string,
  isActive: boolean,
  userId: string
) {
  const [existing] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.entityId, entityId)));
  if (!existing) throw new InventoryError("Item not found");

  await db.update(inventoryItems).set({ isActive }).where(eq(inventoryItems.id, itemId));
  await writeAudit(db, {
    entityId,
    userId,
    action: isActive ? "ITEM_ACTIVATED" : "ITEM_DEACTIVATED",
    tableName: "inventory_items",
    recordId: itemId,
    afterState: { isActive },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listItems(entityId: string, opts?: { activeOnly?: boolean }) {
  const rows = await db.execute(sql`
    SELECT i.id, i.sku, i.name, i.costing_method, i.unit, i.sales_price, i.is_active,
           COALESCE(SUM(l.qty_remaining), 0)  AS qty_on_hand,
           COALESCE(SUM(l.cost_remaining), 0) AS value_on_hand
    FROM inventory_items i
    LEFT JOIN inventory_lots l ON l.item_id = i.id AND l.qty_remaining > 0
    WHERE i.entity_id = ${entityId}
      ${opts?.activeOnly ? sql`AND i.is_active` : sql``}
    GROUP BY i.id
    ORDER BY i.sku
  `);
  return (
    rows.rows as {
      id: string;
      sku: string;
      name: string;
      costing_method: CostingMethod;
      unit: string;
      sales_price: string;
      is_active: boolean;
      qty_on_hand: string;
      value_on_hand: string;
    }[]
  ).map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    costingMethod: r.costing_method,
    unit: r.unit,
    salesPrice: r.sales_price,
    isActive: r.is_active,
    qtyOnHand: r.qty_on_hand,
    valueOnHand: r.value_on_hand,
  }));
}

export async function getItem(itemId: string, entityId: string) {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.entityId, entityId)));
  if (!item) return null;

  const lots = await db
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.itemId, itemId))
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt));

  const movements = await db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.itemId, itemId))
    .orderBy(desc(inventoryMovements.date), desc(inventoryMovements.createdAt))
    .limit(200);

  const openLots = lots.filter((l) => new Decimal(l.qtyRemaining).greaterThan(0));
  const qtyOnHand = openLots.reduce((s, l) => s.plus(l.qtyRemaining), new Decimal(0));
  const valueOnHand = openLots.reduce((s, l) => s.plus(l.costRemaining), new Decimal(0));

  return {
    item,
    lots,
    openLots,
    movements,
    qtyOnHand: qtyOnHand.toString(),
    valueOnHand: valueOnHand.toFixed(2),
  };
}

/** Subledger total vs the GL inventory account — surfaced on the items page. */
export async function inventoryGlTieOut(entityId: string) {
  const inventoryAccountId = await resolveMapping(entityId, "inventory_asset");
  const [account] = await db
    .select({ number: chartOfAccounts.accountNumber, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.id, inventoryAccountId));

  const glRows = await db.execute(sql`
    SELECT COALESCE(SUM(jel.debit_base - jel.credit_base), 0) AS balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.je_id
    WHERE jel.account_id = ${inventoryAccountId}
      AND je.status IN ('posted', 'voided')
  `);
  const glBalance = new Decimal(String((glRows.rows[0] as { balance: string }).balance));

  const subRows = await db.execute(sql`
    SELECT COALESCE(SUM(l.cost_remaining), 0) AS value
    FROM inventory_lots l
    WHERE l.entity_id = ${entityId} AND l.qty_remaining > 0
  `);
  const subledger = new Decimal(String((subRows.rows[0] as { value: string }).value));

  return {
    account: account ? `${account.number} — ${account.name}` : "Inventory",
    glBalance: glBalance.toFixed(2),
    subledger: subledger.toFixed(2),
    difference: glBalance.minus(subledger).toFixed(2),
    inBalance: glBalance.minus(subledger).isZero(),
  };
}

// ---------------------------------------------------------------------------
// Costing engine
// ---------------------------------------------------------------------------

type LockedLot = {
  id: string;
  lot_ref: string | null;
  received_date: string;
  qty_remaining: string;
  cost_remaining: string;
};

/** Lock an item's open lots for update, oldest first. */
async function lockOpenLots(tx: Tx, itemId: string): Promise<LockedLot[]> {
  const rows = await tx.execute(sql`
    SELECT id, lot_ref, received_date, qty_remaining, cost_remaining
    FROM inventory_lots
    WHERE item_id = ${itemId} AND qty_remaining > 0
    ORDER BY received_date, created_at
    FOR UPDATE
  `);
  return rows.rows as LockedLot[];
}

export type LotPick = { lotId: string; quantity: string | number };

export type ConsumptionPlan = {
  totalCost: Decimal;
  legs: { lotId: string; qty: Decimal; cost: Decimal; newQty: Decimal; newCost: Decimal }[];
};

/**
 * Plan lot consumption for `qty` of an item under its costing method.
 * Guarantees SUM(leg.cost) === totalCost and that any fully-drained lot ends
 * at cost 0 — the subledger sum invariant.
 */
function planConsumption(
  method: CostingMethod,
  lots: LockedLot[],
  qty: Decimal,
  picks?: LotPick[]
): ConsumptionPlan {
  const onHand = lots.reduce((s, l) => s.plus(l.qty_remaining), new Decimal(0));
  if (qty.greaterThan(onHand)) {
    throw new InventoryError(
      `Insufficient stock: ${qty.toString()} requested, ${onHand.toString()} on hand`
    );
  }

  const legs: ConsumptionPlan["legs"] = [];

  // Specific ID with explicit picks. Without picks (e.g. invoice posting,
  // which has no lot picker), specific-ID items fall through to the
  // oldest-first walk below — the movement's lot legs still record exactly
  // which lots were consumed, and manual issues allow hand-picking.
  if (method === "specific" && picks && picks.length > 0) {
    const byId = new Map(lots.map((l) => [l.id, l]));
    let pickTotal = new Decimal(0);
    for (const pick of picks) {
      const lot = byId.get(pick.lotId);
      if (!lot) throw new InventoryError("Selected lot not found or already empty");
      const take = new Decimal(pick.quantity || 0);
      if (take.lessThanOrEqualTo(0)) continue;
      const remaining = new Decimal(lot.qty_remaining);
      if (take.greaterThan(remaining)) {
        throw new InventoryError(
          `Lot ${lot.lot_ref ?? lot.id.slice(0, 8)} has only ${remaining.toString()} remaining`
        );
      }
      const lotCost = new Decimal(lot.cost_remaining);
      const cost = take.equals(remaining)
        ? lotCost
        : take.times(lotCost).dividedBy(remaining).toDecimalPlaces(2);
      legs.push({
        lotId: lot.id,
        qty: take,
        cost,
        newQty: remaining.minus(take),
        newCost: lotCost.minus(cost),
      });
      pickTotal = pickTotal.plus(take);
    }
    if (!pickTotal.equals(qty)) {
      throw new InventoryError(
        `Selected lot quantities (${pickTotal.toString()}) must add up to the issue quantity (${qty.toString()})`
      );
    }
    return { totalCost: legs.reduce((s, l) => s.plus(l.cost), new Decimal(0)), legs };
  }

  // FIFO and AVCO both drain lots oldest-first; they differ only in pricing.
  const valueOnHand = lots.reduce((s, l) => s.plus(l.cost_remaining), new Decimal(0));
  const isEverything = qty.equals(onHand);

  // AVCO prices the whole issue at the current weighted average.
  const avcoTotal = isEverything
    ? valueOnHand
    : qty.times(valueOnHand).dividedBy(onHand).toDecimalPlaces(2);

  let remainingToTake = qty;
  let avcoCostLeft = avcoTotal;

  for (const lot of lots) {
    if (remainingToTake.lessThanOrEqualTo(0)) break;
    const lotQty = new Decimal(lot.qty_remaining);
    const lotCost = new Decimal(lot.cost_remaining);
    const take = Decimal.min(remainingToTake, lotQty);
    const drained = take.equals(lotQty);

    let cost: Decimal;
    if (method !== "avco") {
      // FIFO — and specific-ID auto-picking, which is FIFO-priced because the
      // cost of the actual layers consumed IS the specific cost.
      cost = drained ? lotCost : take.times(lotCost).dividedBy(lotQty).toDecimalPlaces(2);
    } else {
      // AVCO: a drained lot must end at zero cost, so it contributes its whole
      // value; the last (partial) lot absorbs the difference so the legs sum
      // exactly to the average-priced total.
      cost = drained ? lotCost : avcoCostLeft;
      if (cost.greaterThan(lotCost)) {
        // Partial take may not push a lot's cost negative; cap and let the
        // remainder fall to the next lot (only possible with rising costs).
        cost = drained ? cost : Decimal.min(cost, lotCost);
      }
    }

    legs.push({
      lotId: lot.id,
      qty: take,
      cost,
      newQty: lotQty.minus(take),
      newCost: lotCost.minus(cost),
    });
    remainingToTake = remainingToTake.minus(take);
    avcoCostLeft = avcoCostLeft.minus(cost);
  }

  if (method === "avco" && !avcoCostLeft.isZero()) {
    // Residual from drained-lot rounding: settle it against the last leg whose
    // lot still has value (or quantity) left, keeping SUM(legs) === avcoTotal.
    for (let i = legs.length - 1; i >= 0; i--) {
      const adjusted = legs[i].cost.plus(avcoCostLeft);
      const lotValue = legs[i].cost.plus(legs[i].newCost);
      if (adjusted.greaterThanOrEqualTo(0) && adjusted.lessThanOrEqualTo(lotValue)) {
        legs[i].cost = adjusted;
        legs[i].newCost = lotValue.minus(adjusted);
        avcoCostLeft = new Decimal(0);
        break;
      }
    }
  }

  const totalCost = legs.reduce((s, l) => s.plus(l.cost), new Decimal(0));
  return { totalCost, legs };
}

/** Apply a consumption plan to the locked lots. */
async function applyConsumption(tx: Tx, plan: ConsumptionPlan, movementId: string) {
  for (const leg of plan.legs) {
    await tx
      .update(inventoryLots)
      .set({ qtyRemaining: leg.newQty.toString(), costRemaining: leg.newCost.toFixed(2) })
      .where(eq(inventoryLots.id, leg.lotId));
    await tx.insert(inventoryMovementLots).values({
      movementId,
      lotId: leg.lotId,
      quantity: leg.qty.toString(),
      cost: leg.cost.toFixed(2),
    });
  }
}

/**
 * Consume stock inside an open transaction: plans under the item's costing
 * method, decrements lots, records the movement + its lot legs. The CALLER
 * posts the JE (in the same tx) and passes its id in. Used by manual issues,
 * adjustments, write-downs AND invoice posting.
 */
export async function consumeStockInTx(
  tx: Tx,
  params: {
    entityId: string;
    itemId: string;
    kind: "issue" | "adjust_out" | "write_down";
    date: string;
    quantity: Decimal;
    jeId: string;
    invoiceId?: string;
    reference?: string;
    notes?: string;
    picks?: LotPick[];
  },
  userId: string
): Promise<{ movementId: string; totalCost: Decimal }> {
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, params.itemId), eq(inventoryItems.entityId, params.entityId)));
  if (!item) throw new InventoryError("Item not found");

  const lots = await lockOpenLots(tx, params.itemId);
  const plan = planConsumption(item.costingMethod, lots, params.quantity, params.picks);

  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      entityId: params.entityId,
      itemId: params.itemId,
      kind: params.kind,
      date: params.date,
      quantity: params.quantity.toString(),
      totalCost: plan.totalCost.toFixed(2),
      jeId: params.jeId,
      invoiceId: params.invoiceId,
      reference: params.reference,
      notes: params.notes,
      createdBy: userId,
    })
    .returning({ id: inventoryMovements.id });

  await applyConsumption(tx, plan, movement.id);
  return { movementId: movement.id, totalCost: plan.totalCost };
}

/**
 * Pre-compute the cost of consuming `qty` without touching anything — used by
 * invoice posting, which must know COGS before it can build the JE lines.
 * Locks the lots so the plan stays valid for the rest of the transaction.
 */
export async function planConsumptionInTx(
  tx: Tx,
  entityId: string,
  itemId: string,
  qty: Decimal,
  picks?: LotPick[]
): Promise<{ item: typeof inventoryItems.$inferSelect; plan: ConsumptionPlan; lots: LockedLot[] }> {
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.entityId, entityId)));
  if (!item) throw new InventoryError("Item not found");
  const lots = await lockOpenLots(tx, itemId);
  return { item, plan: planConsumption(item.costingMethod, lots, qty, picks), lots };
}

/** Record already-planned consumption (invoice posting path). */
export async function recordPlannedConsumptionInTx(
  tx: Tx,
  params: {
    entityId: string;
    itemId: string;
    date: string;
    quantity: Decimal;
    plan: ConsumptionPlan;
    jeId: string;
    invoiceId?: string;
    reference?: string;
  },
  userId: string
): Promise<string> {
  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      entityId: params.entityId,
      itemId: params.itemId,
      kind: "issue",
      date: params.date,
      quantity: params.quantity.toString(),
      totalCost: params.plan.totalCost.toFixed(2),
      jeId: params.jeId,
      invoiceId: params.invoiceId,
      reference: params.reference,
      createdBy: userId,
    })
    .returning({ id: inventoryMovements.id });
  await applyConsumption(tx, params.plan, movement.id);
  return movement.id;
}

/**
 * Add stock inside an open transaction: creates the movement and its cost
 * layer. Caller posts the JE first (same tx). Used by manual receipts,
 * positive adjustments AND bill posting.
 */
export async function receiveStockInTx(
  tx: Tx,
  params: {
    entityId: string;
    itemId: string;
    kind: "receipt" | "adjust_in";
    date: string;
    quantity: Decimal;
    unitCost: Decimal;
    /** Exact value posted to the GL (e.g. a bill line's net). Overrides
     *  qty x unitCost so the lot's book value matches the ledger to the cent. */
    totalCostOverride?: Decimal;
    jeId: string;
    billId?: string;
    lotRef?: string;
    reference?: string;
    notes?: string;
  },
  userId: string
): Promise<{ movementId: string; totalCost: Decimal }> {
  const totalCost =
    params.totalCostOverride ?? params.quantity.times(params.unitCost).toDecimalPlaces(2);

  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      entityId: params.entityId,
      itemId: params.itemId,
      kind: params.kind,
      date: params.date,
      quantity: params.quantity.toString(),
      totalCost: totalCost.toFixed(2),
      jeId: params.jeId,
      billId: params.billId,
      reference: params.reference,
      notes: params.notes,
      createdBy: userId,
    })
    .returning({ id: inventoryMovements.id });

  await tx.insert(inventoryLots).values({
    entityId: params.entityId,
    itemId: params.itemId,
    lotRef: params.lotRef || undefined,
    receivedDate: params.date,
    qtyReceived: params.quantity.toString(),
    qtyRemaining: params.quantity.toString(),
    unitCost: params.unitCost.toFixed(6),
    costRemaining: totalCost.toFixed(2),
    sourceMovementId: movement.id,
  });

  return { movementId: movement.id, totalCost };
}

// ---------------------------------------------------------------------------
// Manual movements (standalone, outside documents)
// ---------------------------------------------------------------------------

export type ManualMovementInput = {
  entityId: string;
  itemId: string;
  kind: "receipt" | "issue" | "adjust_in" | "adjust_out" | "write_down";
  date: string;
  quantity: string | number;
  /** receipts / adjust_in only */
  unitCost?: string | number;
  lotRef?: string;
  /** counter account; defaults per kind via mappings */
  counterAccountId?: string;
  /** specific-ID issues */
  picks?: LotPick[];
  reference?: string;
  notes?: string;
};

const KIND_LABEL: Record<ManualMovementInput["kind"], string> = {
  receipt: "Stock receipt",
  issue: "Stock issue",
  adjust_in: "Count adjustment (up)",
  adjust_out: "Count adjustment (down)",
  write_down: "Inventory write-down",
};

/**
 * Record a manual stock movement + its journal entry atomically.
 *   receipt / adjust_in    DR Inventory        CR counter (GRNI / write-down)
 *   issue                  DR counter (COGS)   CR Inventory
 *   adjust_out/write_down  DR write-down       CR Inventory
 */
export async function recordManualMovement(input: ManualMovementInput, userId: string) {
  const qty = new Decimal(input.quantity || 0);
  if (qty.lessThanOrEqualTo(0)) throw new InventoryError("Quantity must be greater than zero");

  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.entityId, input.entityId)));
  if (!item) throw new InventoryError("Item not found");
  if (!item.isActive) throw new InventoryError("Item is inactive");

  const inventoryAccount = await resolveMapping(input.entityId, "inventory_asset");
  const isInbound = input.kind === "receipt" || input.kind === "adjust_in";

  let counterAccountId = input.counterAccountId;
  if (!counterAccountId) {
    counterAccountId = await resolveMapping(
      input.entityId,
      input.kind === "receipt" ? "grni" : input.kind === "issue" ? "cogs" : "inventory_writedown"
    );
  }

  let unitCost = new Decimal(0);
  if (isInbound) {
    unitCost = new Decimal(input.unitCost || 0);
    if (unitCost.lessThanOrEqualTo(0)) {
      throw new InventoryError("Receipts need a unit cost greater than zero");
    }
  }

  return withTransaction(async (tx) => {
    let totalCost: Decimal;
    let movementId: string;

    if (isInbound) {
      totalCost = qty.times(unitCost).toDecimalPlaces(2);
      const { jeId } = await postJournalEntry(
        {
          entityId: input.entityId,
          date: input.date,
          description: `${KIND_LABEL[input.kind]} — ${item.sku} ${item.name}`,
          reference: input.reference || item.sku,
          sourceModule: "inventory",
          lines: [
            { accountId: inventoryAccount, debit: totalCost.toFixed(2) },
            { accountId: counterAccountId!, credit: totalCost.toFixed(2) },
          ],
        },
        userId,
        tx
      );
      const res = await receiveStockInTx(
        tx,
        {
          entityId: input.entityId,
          itemId: input.itemId,
          kind: input.kind as "receipt" | "adjust_in",
          date: input.date,
          quantity: qty,
          unitCost,
          jeId,
          lotRef: input.lotRef,
          reference: input.reference,
          notes: input.notes,
        },
        userId
      );
      movementId = res.movementId;
    } else {
      // Outbound: plan first (needs the cost for the JE), then post + apply.
      const { plan } = await planConsumptionInTx(tx, input.entityId, input.itemId, qty, input.picks);
      totalCost = plan.totalCost;
      if (totalCost.lessThanOrEqualTo(0)) {
        throw new InventoryError("Nothing to post: the selected stock has zero book value");
      }
      const { jeId } = await postJournalEntry(
        {
          entityId: input.entityId,
          date: input.date,
          description: `${KIND_LABEL[input.kind]} — ${item.sku} ${item.name}`,
          reference: input.reference || item.sku,
          sourceModule: "inventory",
          lines: [
            { accountId: counterAccountId!, debit: totalCost.toFixed(2) },
            { accountId: inventoryAccount, credit: totalCost.toFixed(2) },
          ],
        },
        userId,
        tx
      );
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          entityId: input.entityId,
          itemId: input.itemId,
          kind: input.kind,
          date: input.date,
          quantity: qty.toString(),
          totalCost: totalCost.toFixed(2),
          jeId,
          reference: input.reference,
          notes: input.notes,
          createdBy: userId,
        })
        .returning({ id: inventoryMovements.id });
      await applyConsumption(tx, plan, movement.id);
      movementId = movement.id;
    }

    await writeAudit(tx, {
      entityId: input.entityId,
      userId,
      action: "INVENTORY_MOVEMENT",
      tableName: "inventory_movements",
      recordId: movementId,
      afterState: {
        kind: input.kind,
        sku: item.sku,
        quantity: qty.toString(),
        totalCost: totalCost.toFixed(2),
      },
    });

    return { movementId, totalCost: totalCost.toFixed(2) };
  });
}
