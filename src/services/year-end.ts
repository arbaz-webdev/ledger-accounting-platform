import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db";
import { entities, fiscalYearCloses, journalEntries, periods } from "@/db/schema";
import { postJournalEntry, voidJournalEntry, type JournalEntryInput } from "@/services/journal";
import { resolveMapping } from "@/services/mappings";
import { ensureYearPeriods, setPeriodLock } from "@/services/periods";
import { writeAudit } from "@/services/audit";
import { assertSuspenseClear } from "@/services/account-policy";

/**
 * Year-end close (Phase 7). Closing a fiscal year posts ONE real journal
 * entry, dated the last day of the year, that zeroes every P&L account's
 * cumulative balance into Retained Earnings — the classic closing entry.
 * Because it sweeps CUMULATIVE balances, a first-ever close also absorbs any
 * unclosed prior-year activity, exactly mirroring how the balance sheet's
 * "prior earnings" line was computed before the close (so the balance sheet
 * stays balanced and that line simply becomes zero).
 *
 * Closing also locks every period of the year. Reopening voids the closing JE
 * (reversal dated the same year-end day) and marks the close row — history is
 * append-only, so a re-close after reopening creates a new row.
 */

export class YearEndError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YearEndError";
  }
}

/** Matches PL_TYPES in statements.ts — the accounts netIncome() sums over. */
const PL_TYPES = ["revenue", "cogs", "expense", "other_income", "other_expense", "tax"] as const;

export type FyRange = { label: string; start: string; end: string; startYear: number };

export function fyRange(startYear: number, fyStartMonth: number): FyRange {
  const start = `${startYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, fyStartMonth - 1, 1));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  const label = fyStartMonth === 1 ? `FY${startYear}` : `FY${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { label, start, end, startYear };
}

async function entityFyStartMonth(entityId: string): Promise<number> {
  const [row] = await db
    .select({ fy: entities.fiscalYearStartMonth })
    .from(entities)
    .where(eq(entities.id, entityId));
  if (!row) throw new YearEndError("Entity not found");
  return row.fy;
}

/** Per-account cumulative P&L balances up to a date (posted + voided). */
async function plBalancesAsOf(entityId: string, asOf: string, executor: Db | Tx = db) {
  const res = await executor.execute(sql`
    SELECT a.id, a.account_number AS number, a.name,
           COALESCE(SUM(l.credit_base - l.debit_base), 0) AS net
    FROM chart_of_accounts a
    JOIN journal_entry_lines l ON l.account_id = a.id
    JOIN journal_entries je ON je.id = l.je_id
      AND je.status IN ('posted', 'voided') AND je.date <= ${asOf}
    WHERE a.entity_id = ${entityId}
      AND a.type IN (${sql.join(PL_TYPES.map((t) => sql`${t}`), sql`, `)})
    GROUP BY a.id, a.account_number, a.name
    HAVING COALESCE(SUM(l.credit_base - l.debit_base), 0) <> 0
    ORDER BY a.account_number
  `);
  return (res.rows as { id: string; number: string; name: string; net: string }[]).map((r) => ({
    ...r,
    net: new Decimal(r.net), // positive = credit balance (revenue-like)
  }));
}

/** Net income over a window (for display), same account set as statements. */
async function netIncomeBetween(entityId: string, from: string, to: string): Promise<Decimal> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(l.credit_base - l.debit_base), 0) AS net
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.je_id
    JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE a.entity_id = ${entityId}
      AND a.type IN (${sql.join(PL_TYPES.map((t) => sql`${t}`), sql`, `)})
      AND je.status IN ('posted', 'voided')
      AND je.date >= ${from} AND je.date <= ${to}
      AND NOT EXISTS (SELECT 1 FROM fiscal_year_closes fy
        WHERE fy.entity_id=${entityId} AND (fy.je_id=je.id OR fy.je_id=je.reverses_je_id))
  `);
  return new Decimal(String((res.rows[0] as { net: string }).net));
}

export type FyStatus = {
  range: FyRange;
  close: (typeof fiscalYearCloses.$inferSelect & { jeNumber: number | null }) | null;
  yearProfit: string;
  /** total that a close would sweep (includes unclosed prior years) */
  sweepTotal: string;
  sweepIncludesPrior: boolean;
  periodsLocked: number;
  periodsTotal: number;
  finalPeriodLocked: boolean;
  hasActivity: boolean;
};

export async function getFyStatus(entityId: string, startYear: number): Promise<FyStatus> {
  const fyStartMonth = await entityFyStartMonth(entityId);
  const range = fyRange(startYear, fyStartMonth);

  const closeRows = await db
    .select()
    .from(fiscalYearCloses)
    .where(
      and(
        eq(fiscalYearCloses.entityId, entityId),
        eq(fiscalYearCloses.startDate, range.start),
        isNull(fiscalYearCloses.reopenedAt)
      )
    );
  let close: FyStatus["close"] = null;
  if (closeRows[0]) {
    let jeNumber: number | null = null;
    if (closeRows[0].jeId) {
      const [je] = await db
        .select({ n: journalEntries.jeNumber })
        .from(journalEntries)
        .where(eq(journalEntries.id, closeRows[0].jeId));
      jeNumber = je?.n ?? null;
    }
    close = { ...closeRows[0], jeNumber };
  }

  const yearProfit = await netIncomeBetween(entityId, range.start, range.end);
  const balances = await plBalancesAsOf(entityId, range.end);
  const sweepTotal = balances.reduce((s, b) => s.plus(b.net), new Decimal(0));

  const periodRows = await db
    .select({ isLocked: periods.isLocked, year: periods.year, month: periods.month })
    .from(periods)
    .where(
      and(
        eq(periods.entityId, entityId),
        gte(sql`make_date(${periods.year}, ${periods.month}, 1)`, range.start),
        lte(sql`make_date(${periods.year}, ${periods.month}, 1)`, range.end)
      )
    );
  const endYear = Number(range.end.slice(0, 4));
  const endMonth = Number(range.end.slice(5, 7));
  const finalPeriod = periodRows.find((p) => p.year === endYear && p.month === endMonth);
  const activity = await db.execute(sql`SELECT 1 FROM journal_entries WHERE entity_id=${entityId}
    AND status IN ('posted','voided') AND date BETWEEN ${range.start} AND ${range.end} LIMIT 1`);

  return {
    range,
    close,
    yearProfit: yearProfit.toFixed(2),
    sweepTotal: sweepTotal.toFixed(2),
    sweepIncludesPrior: !sweepTotal.equals(yearProfit),
    periodsLocked: periodRows.filter((p) => p.isLocked).length,
    periodsTotal: 12,
    finalPeriodLocked: finalPeriod?.isLocked ?? false,
    hasActivity: activity.rows.length > 0,
  };
}

export async function listFyCloses(entityId: string) {
  const rows = await db
    .select()
    .from(fiscalYearCloses)
    .where(eq(fiscalYearCloses.entityId, entityId))
    .orderBy(desc(fiscalYearCloses.closedAt));
  return rows;
}

export async function closeFiscalYear(entityId: string, startYear: number, userId: string) {
  return db.transaction(async (tx) => {
  await tx.select({ id: entities.id }).from(entities).where(eq(entities.id, entityId)).for("update");
  const fyStartMonth = await entityFyStartMonth(entityId);
  const range = fyRange(startYear, fyStartMonth);
  const endYear = Number(range.end.slice(0, 4));
  const endMonth = Number(range.end.slice(5, 7));

  // Guards
  const existing = await tx
    .select({ id: fiscalYearCloses.id })
    .from(fiscalYearCloses)
    .where(
      and(
        eq(fiscalYearCloses.entityId, entityId),
        eq(fiscalYearCloses.startDate, range.start),
        isNull(fiscalYearCloses.reopenedAt)
      )
    );
  if (existing.length > 0) throw new YearEndError(`${range.label} is already closed`);

  const laterClose = await tx
    .select({ label: fiscalYearCloses.label })
    .from(fiscalYearCloses)
    .where(
      and(
        eq(fiscalYearCloses.entityId, entityId),
        gte(fiscalYearCloses.startDate, range.end),
        isNull(fiscalYearCloses.reopenedAt)
      )
    );
  if (laterClose.length > 0) {
    throw new YearEndError(
      `${laterClose[0].label} is already closed — years must be closed in order`
    );
  }

  // Period rows must exist; the final one must be open so the closing JE can post
  await assertSuspenseClear(entityId, range.end, tx);
  const activity = await tx.execute(sql`SELECT 1 FROM journal_entries
    WHERE entity_id=${entityId} AND status IN ('posted','voided') AND date BETWEEN ${range.start} AND ${range.end} LIMIT 1`);
  if (!activity.rows.length) throw new YearEndError("Cannot close a fiscal year with no posted activity");
  await ensureYearPeriods(entityId, startYear, tx);
  if (endYear !== startYear) await ensureYearPeriods(entityId, endYear, tx);
  const [finalPeriod] = await tx
    .select()
    .from(periods)
    .where(
      and(eq(periods.entityId, entityId), eq(periods.year, endYear), eq(periods.month, endMonth))
    );
  if (finalPeriod?.isLocked) {
    throw new YearEndError(
      `The final period ${endYear}-${String(endMonth).padStart(2, "0")} is locked — unlock it, then close the year`
    );
  }

  const balances = await plBalancesAsOf(entityId, range.end, tx);
  const netProfit = balances.reduce((s, b) => s.plus(b.net), new Decimal(0));

    let jeId: string | null = null;
    let jeNumber: number | null = null;

    if (balances.length > 0) {
      const retainedEarnings = await resolveMapping(entityId, "retained_earnings");
      const lines: JournalEntryInput["lines"] = [];
      for (const b of balances) {
        // Zero the account: credit-balance accounts are debited, and vice versa
        if (b.net.greaterThan(0)) lines.push({ accountId: b.id, debit: b.net.toFixed(2) });
        else lines.push({ accountId: b.id, credit: b.net.abs().toFixed(2) });
      }
      if (netProfit.greaterThan(0)) {
        lines.push({
          accountId: retainedEarnings,
          description: `Net profit for ${range.label}`,
          credit: netProfit.toFixed(2),
        });
      } else if (netProfit.lessThan(0)) {
        lines.push({
          accountId: retainedEarnings,
          description: `Net loss for ${range.label}`,
          debit: netProfit.abs().toFixed(2),
        });
      }

      const posted = await postJournalEntry(
        {
          entityId,
          date: range.end,
          description: `Year-end closing entry ${range.label}`,
          reference: range.label,
          sourceModule: "system",
          lines,
        },
        userId,
        tx
      );
      jeId = posted.jeId;
      jeNumber = posted.jeNumber;
    }

    const [closeRow] = await tx
      .insert(fiscalYearCloses)
      .values({
        entityId,
        label: range.label,
        startDate: range.start,
        endDate: range.end,
        netProfit: netProfit.toFixed(2),
        jeId,
        closedBy: userId,
      })
      .returning();

    // Lock every period of the fiscal year
    await tx.execute(sql`
      UPDATE periods
      SET is_locked = true, locked_by = ${userId}, locked_at = now()
      WHERE entity_id = ${entityId} AND NOT is_locked
        AND make_date(year, month, 1) >= ${range.start}
        AND make_date(year, month, 1) <= ${range.end}
    `);

    await writeAudit(tx, {
      entityId,
      userId,
      action: "FY_CLOSED",
      tableName: "fiscal_year_closes",
      recordId: closeRow.id,
      afterState: { label: range.label, netProfit: netProfit.toFixed(2), jeNumber },
    });

    return { closeId: closeRow.id, jeId, jeNumber, netProfit: netProfit.toFixed(2) };
  });
}

export async function reopenFiscalYear(entityId: string, closeId: string, userId: string, reason: string) {
  if (reason.trim().length < 5) throw new YearEndError("Enter a reopening reason of at least five characters");
  return db.transaction(async (tx) => {
    await tx.select({ id: entities.id }).from(entities).where(eq(entities.id, entityId)).for("update");
    const [close] = await tx
      .select()
      .from(fiscalYearCloses)
      .where(and(eq(fiscalYearCloses.id, closeId), eq(fiscalYearCloses.entityId, entityId))).for("update");
    if (!close) throw new YearEndError("Close record not found");
    if (close.reopenedAt) throw new YearEndError(`${close.label} was already reopened`);

    // Later active closes must be reopened first — their closing entries would
    // otherwise double-count the balances this reversal re-opens.
    const later = await tx
      .select({ label: fiscalYearCloses.label })
      .from(fiscalYearCloses)
      .where(
        and(
          eq(fiscalYearCloses.entityId, entityId),
          gte(fiscalYearCloses.startDate, close.endDate),
          isNull(fiscalYearCloses.reopenedAt)
        )
      );
    if (later.length > 0) {
      throw new YearEndError(`Reopen ${later[0].label} first — years must be reopened newest-first`);
    }

    const endYear = Number(close.endDate.slice(0, 4));
    const endMonth = Number(close.endDate.slice(5, 7));

    // The reversal is dated the year-end day, so that period must be open
    await setPeriodLock(entityId, endYear, endMonth, false, userId, tx, reason);

    let reversalJeNumber: number | null = null;
    if (close.jeId) {
      const { reversalJeNumber: n } = await voidJournalEntry(close.jeId, entityId, userId, close.endDate, tx);
      reversalJeNumber = n;
    }

    await tx
      .update(fiscalYearCloses)
      .set({ reopenedAt: new Date(), reopenedBy: userId })
      .where(eq(fiscalYearCloses.id, closeId));

    await writeAudit(tx, {
      entityId,
      userId,
      action: "FY_REOPENED",
      tableName: "fiscal_year_closes",
      recordId: closeId,
      afterState: { label: close.label, reversalJeNumber, reason: reason.trim() },
    });

    return { reversalJeNumber };
  });
}
