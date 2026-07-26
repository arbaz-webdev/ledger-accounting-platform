import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, fxRates } from "@/db/schema";
import { writeAudit } from "@/services/audit";

/**
 * Foreign exchange (Phase 8).
 *
 * Rates are quoted as units of BASE currency per 1 unit of the foreign
 * currency (so EUR 1 = 1.09 USD is stored as rate 1.09 for currency EUR in a
 * USD-based entity). `resolveRate` picks the latest rate dated on or before
 * the transaction date — the standard "rate ruling at the date" convention.
 *
 * The ledger itself never changes: `debit_base` / `credit_base` have always
 * been the base-currency amounts every report reads. A document is booked at
 * its own rate; settling it at a different rate produces a realised gain or
 * loss, which is exactly what keeps the control account tied to the subledger.
 */

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}

/** A short list of common currencies for the pickers; any 3-letter code works. */
export const COMMON_CURRENCIES = [
  "USD", "EUR", "GBP", "PKR", "AED", "SAR", "INR", "CNY", "JPY", "AUD", "CAD", "CHF",
] as const;

export async function getBaseCurrency(entityId: string): Promise<string> {
  const [row] = await db
    .select({ base: entities.baseCurrency })
    .from(entities)
    .where(eq(entities.id, entityId));
  if (!row) throw new FxError("Entity not found");
  return row.base;
}

/**
 * Rate to convert `currency` into the entity's base currency on `date`.
 * Base currency is always exactly 1. Throws if no rate has been entered on or
 * before the date — silently defaulting to 1 would post wrong numbers.
 */
export async function resolveRate(
  entityId: string,
  currency: string,
  date: string
): Promise<Decimal> {
  const base = await getBaseCurrency(entityId);
  if (currency === base) return new Decimal(1);

  const [row] = await db
    .select({ rate: fxRates.rate, asOf: fxRates.asOfDate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.entityId, entityId),
        eq(fxRates.currency, currency),
        lte(fxRates.asOfDate, date)
      )
    )
    .orderBy(desc(fxRates.asOfDate))
    .limit(1);

  if (!row) {
    throw new FxError(
      `No ${currency} exchange rate on or before ${date}. Add one under Administration → FX rates.`
    );
  }
  return new Decimal(row.rate);
}

/** Same as resolveRate but returns null instead of throwing (for UI hints). */
export async function tryResolveRate(
  entityId: string,
  currency: string,
  date: string
): Promise<string | null> {
  try {
    return (await resolveRate(entityId, currency, date)).toString();
  } catch {
    return null;
  }
}

export async function listFxRates(entityId: string) {
  return db
    .select()
    .from(fxRates)
    .where(eq(fxRates.entityId, entityId))
    .orderBy(fxRates.currency, desc(fxRates.asOfDate));
}

/** Currencies that have at least one rate, plus the base currency. */
export async function listEntityCurrencies(entityId: string): Promise<string[]> {
  const base = await getBaseCurrency(entityId);
  const rows = await db
    .selectDistinct({ currency: fxRates.currency })
    .from(fxRates)
    .where(eq(fxRates.entityId, entityId));
  const set = new Set<string>([base, ...rows.map((r) => r.currency)]);
  return [...set].sort();
}

export async function setFxRate(
  entityId: string,
  input: { currency: string; asOfDate: string; rate: string | number },
  userId: string
) {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new FxError("Currency must be a 3-letter code");

  const base = await getBaseCurrency(entityId);
  if (currency === base) {
    throw new FxError(`${base} is the base currency — its rate is always 1`);
  }

  const rate = new Decimal(input.rate || 0);
  if (rate.lessThanOrEqualTo(0)) throw new FxError("Rate must be greater than zero");

  await db
    .insert(fxRates)
    .values({
      entityId,
      currency,
      asOfDate: input.asOfDate,
      rate: rate.toString(),
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [fxRates.entityId, fxRates.currency, fxRates.asOfDate],
      set: { rate: rate.toString() },
    });

  await writeAudit(db, {
    entityId,
    userId,
    action: "FX_RATE_SET",
    tableName: "fx_rates",
    recordId: `${currency}@${input.asOfDate}`,
    afterState: { currency, asOfDate: input.asOfDate, rate: rate.toString(), base },
  });
}

export async function deleteFxRate(entityId: string, rateId: string, userId: string) {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.id, rateId), eq(fxRates.entityId, entityId)));
  if (!row) throw new FxError("Rate not found");

  await db.delete(fxRates).where(eq(fxRates.id, rateId));
  await writeAudit(db, {
    entityId,
    userId,
    action: "FX_RATE_DELETED",
    tableName: "fx_rates",
    recordId: rateId,
    beforeState: { currency: row.currency, asOfDate: row.asOfDate, rate: row.rate },
  });
}

/** Convert a document-currency amount to base at a given rate, to 2dp. */
export function toBase(amount: Decimal | string | number, rate: Decimal | string | number): Decimal {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(2);
}

/**
 * Realised FX on a settlement.
 *
 * The control account was loaded at the DOCUMENT's rate, so it must be
 * relieved at that same rate; cash moves at the SETTLEMENT rate. The
 * difference is the realised gain or loss:
 *
 *   invoice (AR):  cash in  = amount x settleRate, AR relieved = amount x docRate
 *                  settleRate > docRate  ->  received more base than booked = GAIN
 *   bill (AP):     cash out = amount x settleRate, AP relieved = amount x docRate
 *                  settleRate > docRate  ->  paid more base than booked = LOSS
 */
export function realisedFx(
  amount: Decimal,
  docRate: Decimal,
  settleRate: Decimal,
  isInvoice: boolean
): { baseAtDocRate: Decimal; baseAtSettleRate: Decimal; difference: Decimal; isGain: boolean } {
  const baseAtDocRate = toBase(amount, docRate);
  const baseAtSettleRate = toBase(amount, settleRate);
  const raw = baseAtSettleRate.minus(baseAtDocRate);
  // For a bill the sign flips: paying more base currency is a loss.
  const signed = isInvoice ? raw : raw.negated();
  return {
    baseAtDocRate,
    baseAtSettleRate,
    difference: signed.abs(),
    isGain: signed.greaterThan(0),
  };
}

/** Total base-currency value of open foreign-currency documents, for the FX page. */
export async function foreignExposure(entityId: string, asOf: string) {
  const res = await db.execute(sql`
    SELECT d.currency,
           SUM(d.open_doc)  AS open_doc,
           SUM(d.open_base) AS open_base,
           d.kind
    FROM (
      SELECT i.currency, 'ar' AS kind,
             (i.total - COALESCE((SELECT SUM(s.amount) FROM settlements s
                                  WHERE s.invoice_id = i.id AND s.date <= ${asOf}), 0)) AS open_doc,
             (i.total - COALESCE((SELECT SUM(s.amount) FROM settlements s
                                  WHERE s.invoice_id = i.id AND s.date <= ${asOf}), 0)) * i.fx_rate AS open_base
      FROM invoices i
      WHERE i.entity_id = ${entityId} AND i.status IN ('posted', 'paid') AND i.issue_date <= ${asOf}
      UNION ALL
      SELECT b.currency, 'ap' AS kind,
             (b.total - COALESCE((SELECT SUM(s.amount) FROM settlements s
                                  WHERE s.bill_id = b.id AND s.date <= ${asOf}), 0)) AS open_doc,
             (b.total - COALESCE((SELECT SUM(s.amount) FROM settlements s
                                  WHERE s.bill_id = b.id AND s.date <= ${asOf}), 0)) * b.fx_rate AS open_base
      FROM bills b
      WHERE b.entity_id = ${entityId} AND b.status IN ('posted', 'paid') AND b.issue_date <= ${asOf}
    ) d
    WHERE d.open_doc > 0
    GROUP BY d.currency, d.kind
    ORDER BY d.currency, d.kind
  `);
  return (res.rows as { currency: string; open_doc: string; open_base: string; kind: string }[]).map(
    (r) => ({
      currency: r.currency,
      kind: r.kind as "ar" | "ap",
      openDoc: new Decimal(r.open_doc).toFixed(2),
      openBase: new Decimal(r.open_base).toFixed(2),
    })
  );
}
