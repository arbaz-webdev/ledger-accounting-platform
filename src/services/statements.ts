import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { parseCents, formatCents } from "@/lib/money";

/**
 * Financial statements (spec section 11), derived live from the ledger.
 *
 * Design guarantees:
 *  - Balance Sheet ALWAYS balances (Assets = Liabilities + Equity) because
 *    equity includes the current-year P&L net that hasn't been closed to
 *    Retained Earnings yet, plus any un-closed prior-year P&L.
 *  - Cash Flow (indirect) ALWAYS reconciles to the cash movement, because every
 *    non-cash account is bucketed into exactly one activity section, so the
 *    three sections necessarily sum to the change in cash (double-entry identity).
 *
 * All arithmetic is in integer cents (BigInt); only formatted at the edge.
 */

const MIN_DATE = "0001-01-01";

// ---------------------------------------------------------------------------
// Core: per-account balances over a date window (posted + voided entries).
// Voided entries always have a posted reversal that cancels them, so including
// both keeps every statement consistent with the trial balance.
// ---------------------------------------------------------------------------

type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "cogs"
  | "expense"
  | "other_income"
  | "other_expense"
  | "tax";

type Balance = {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  subType: string | null;
  debit: bigint; // cents
  credit: bigint; // cents
  /** signed balance in the account's natural direction is derived per statement */
};

async function accountBalances(entityId: string, from: string, to: string): Promise<Balance[]> {
  const result = await db.execute(sql`
    SELECT a.id, a.account_number AS number, a.name, a.type, a.sub_type AS subtype,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN l.debit_base  ELSE 0 END), 0) AS debit,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN l.credit_base ELSE 0 END), 0) AS credit
    FROM chart_of_accounts a
    LEFT JOIN journal_entry_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = l.je_id
      AND je.status IN ('posted', 'voided')
      AND je.date >= ${from} AND je.date <= ${to}
    WHERE a.entity_id = ${entityId}
    GROUP BY a.id, a.account_number, a.name, a.type, a.sub_type
    ORDER BY a.account_number
  `);
  return (
    result.rows as {
      id: string;
      number: string;
      name: string;
      type: AccountType;
      subtype: string | null;
      debit: string;
      credit: string;
    }[]
  ).map((r) => ({
    id: r.id,
    number: r.number,
    name: r.name,
    type: r.type,
    subType: r.subtype,
    debit: parseCents(r.debit),
    credit: parseCents(r.credit),
  }));
}

// Classification helpers -----------------------------------------------------

function num(b: Balance): number {
  const n = parseInt(b.number, 10);
  return Number.isNaN(n) ? 0 : n;
}
const PL_TYPES: AccountType[] = ["revenue", "cogs", "expense", "other_income", "other_expense", "tax"];
const isPL = (b: Balance) => PL_TYPES.includes(b.type);
const isCash = (b: Balance) =>
  b.type === "asset" && (b.subType === "cash_and_bank" || (num(b) >= 1000 && num(b) < 1100));
const isContraAsset = (b: Balance) => b.type === "asset" && b.subType === "contra_asset";

/** Natural-direction signed balance: debit-normal accounts positive on debit. */
const debitNet = (b: Balance) => b.debit - b.credit; // assets, expenses
const creditNet = (b: Balance) => b.credit - b.debit; // liabilities, equity, revenue

/** Net income (profit) for the window = Σ over P&L accounts of (credit - debit). */
function netIncome(balances: Balance[]): bigint {
  return balances.filter(isPL).reduce((s, b) => s + creditNet(b), 0n);
}

// ---------------------------------------------------------------------------
// Fiscal-year helpers
// ---------------------------------------------------------------------------

function fiscalYearStart(asOf: string, fyStartMonth: number): string {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const startYear = m >= fyStartMonth ? y : y - 1;
  return `${startYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ===========================================================================
// Profit & Loss (spec 11.1)
// ===========================================================================

export type PLLine = { number: string; name: string; amount: string };
export type ProfitAndLoss = {
  from: string;
  to: string;
  revenue: { lines: PLLine[]; gross: string; discounts: string; net: string };
  cogs: { lines: PLLine[]; gross: string; discounts: string; net: string };
  grossProfit: string;
  operatingExpenses: { lines: PLLine[]; total: string };
  operatingProfit: string;
  otherIncome: { lines: PLLine[]; total: string };
  otherExpense: { lines: PLLine[]; total: string };
  profitBeforeTax: string;
  incomeTax: { lines: PLLine[]; total: string };
  netProfit: string;
};

export async function getProfitAndLoss(
  entityId: string,
  from: string,
  to: string
): Promise<ProfitAndLoss> {
  const balances = await accountBalances(entityId, from, to);
  const active = (b: Balance) => b.debit !== 0n || b.credit !== 0n;

  const line = (b: Balance, amount: bigint): PLLine => ({
    number: b.number,
    name: b.name,
    amount: formatCents(amount),
  });

  // Revenue (4xxx): gross = normal revenue, discounts = contra_revenue
  const revAccounts = balances.filter((b) => b.type === "revenue" && active(b));
  const revGrossLines = revAccounts.filter((b) => b.subType !== "contra_revenue");
  const revDiscLines = revAccounts.filter((b) => b.subType === "contra_revenue");
  const revGross = revGrossLines.reduce((s, b) => s + creditNet(b), 0n);
  const revDisc = revDiscLines.reduce((s, b) => s + debitNet(b), 0n);
  const netRevenue = revGross - revDisc;

  // COGS (5xxx): gross = normal cogs, discounts = contra_cogs
  const cogsAccounts = balances.filter((b) => b.type === "cogs" && active(b));
  const cogsGrossLines = cogsAccounts.filter((b) => b.subType !== "contra_cogs");
  const cogsDiscLines = cogsAccounts.filter((b) => b.subType === "contra_cogs");
  const cogsGross = cogsGrossLines.reduce((s, b) => s + debitNet(b), 0n);
  const cogsDisc = cogsDiscLines.reduce((s, b) => s + creditNet(b), 0n);
  const netCogs = cogsGross - cogsDisc;

  const grossProfit = netRevenue - netCogs;

  const opexAccounts = balances.filter((b) => b.type === "expense" && active(b));
  const opex = opexAccounts.reduce((s, b) => s + debitNet(b), 0n);
  const operatingProfit = grossProfit - opex;

  const otherIncAccounts = balances.filter((b) => b.type === "other_income" && active(b));
  const otherInc = otherIncAccounts.reduce((s, b) => s + creditNet(b), 0n);
  const otherExpAccounts = balances.filter((b) => b.type === "other_expense" && active(b));
  const otherExp = otherExpAccounts.reduce((s, b) => s + debitNet(b), 0n);
  const pbt = operatingProfit + otherInc - otherExp;

  const taxAccounts = balances.filter((b) => b.type === "tax" && active(b));
  const tax = taxAccounts.reduce((s, b) => s + debitNet(b), 0n);
  const netProfit = pbt - tax;

  return {
    from,
    to,
    revenue: {
      lines: revGrossLines.map((b) => line(b, creditNet(b))),
      gross: formatCents(revGross),
      discounts: formatCents(revDisc),
      net: formatCents(netRevenue),
    },
    cogs: {
      lines: cogsGrossLines.map((b) => line(b, debitNet(b))),
      gross: formatCents(cogsGross),
      discounts: formatCents(cogsDisc),
      net: formatCents(netCogs),
    },
    grossProfit: formatCents(grossProfit),
    operatingExpenses: { lines: opexAccounts.map((b) => line(b, debitNet(b))), total: formatCents(opex) },
    operatingProfit: formatCents(operatingProfit),
    otherIncome: { lines: otherIncAccounts.map((b) => line(b, creditNet(b))), total: formatCents(otherInc) },
    otherExpense: { lines: otherExpAccounts.map((b) => line(b, debitNet(b))), total: formatCents(otherExp) },
    profitBeforeTax: formatCents(pbt),
    incomeTax: { lines: taxAccounts.map((b) => line(b, debitNet(b))), total: formatCents(tax) },
    netProfit: formatCents(netProfit),
  };
}

// ===========================================================================
// Balance Sheet (spec 11.2)
// ===========================================================================

export type BSLine = { number: string; name: string; amount: string };
export type BalanceSheet = {
  asOf: string;
  currentAssets: { lines: BSLine[]; total: string };
  nonCurrentAssets: { lines: BSLine[]; total: string };
  totalAssets: string;
  currentLiabilities: { lines: BSLine[]; total: string };
  nonCurrentLiabilities: { lines: BSLine[]; total: string };
  totalLiabilities: string;
  equity: {
    lines: BSLine[];
    priorEarnings: string | null; // unclosed prior-year P&L, shown only if non-zero
    currentYearProfit: string;
    total: string;
  };
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
  difference: string;
};

export async function getBalanceSheet(entityId: string, asOf: string): Promise<BalanceSheet> {
  const entityRows = await db
    .select({ fy: entities.fiscalYearStartMonth })
    .from(entities)
    .where(eq(entities.id, entityId));
  const fyStartMonth = entityRows[0]?.fy ?? 1;
  const fyStart = fiscalYearStart(asOf, fyStartMonth);

  const cumulative = await accountBalances(entityId, MIN_DATE, asOf);
  const active = (b: Balance) => b.debit !== 0n || b.credit !== 0n;
  const line = (b: Balance, amount: bigint): BSLine => ({
    number: b.number,
    name: b.name,
    amount: formatCents(amount),
  });

  // Assets (debit-normal)
  const assets = cumulative.filter((b) => b.type === "asset" && active(b));
  const currentAssetAccts = assets.filter((b) => num(b) < 1500);
  const nonCurrentAssetAccts = assets.filter((b) => num(b) >= 1500);
  const currentAssetsTotal = currentAssetAccts.reduce((s, b) => s + debitNet(b), 0n);
  const nonCurrentAssetsTotal = nonCurrentAssetAccts.reduce((s, b) => s + debitNet(b), 0n);
  const totalAssets = currentAssetsTotal + nonCurrentAssetsTotal;

  // Liabilities (credit-normal)
  const liabilities = cumulative.filter((b) => b.type === "liability" && active(b));
  const currentLiabAccts = liabilities.filter((b) => num(b) < 2500);
  const nonCurrentLiabAccts = liabilities.filter((b) => num(b) >= 2500);
  const currentLiabTotal = currentLiabAccts.reduce((s, b) => s + creditNet(b), 0n);
  const nonCurrentLiabTotal = nonCurrentLiabAccts.reduce((s, b) => s + creditNet(b), 0n);
  const totalLiabilities = currentLiabTotal + nonCurrentLiabTotal;

  // Equity (credit-normal) + unclosed P&L
  const equityAccts = cumulative.filter((b) => b.type === "equity" && active(b));
  const equityAcctTotal = equityAccts.reduce((s, b) => s + creditNet(b), 0n);

  const currentYearProfit = netIncome(
    await accountBalances(entityId, fyStart, asOf)
  );
  const priorEarnings = netIncome(
    await accountBalances(entityId, MIN_DATE, dayBefore(fyStart))
  );

  const totalEquity = equityAcctTotal + priorEarnings + currentYearProfit;
  const totalLE = totalLiabilities + totalEquity;
  const difference = totalAssets - totalLE;

  return {
    asOf,
    currentAssets: {
      lines: currentAssetAccts.map((b) => line(b, debitNet(b))),
      total: formatCents(currentAssetsTotal),
    },
    nonCurrentAssets: {
      lines: nonCurrentAssetAccts.map((b) => line(b, debitNet(b))),
      total: formatCents(nonCurrentAssetsTotal),
    },
    totalAssets: formatCents(totalAssets),
    currentLiabilities: {
      lines: currentLiabAccts.map((b) => line(b, creditNet(b))),
      total: formatCents(currentLiabTotal),
    },
    nonCurrentLiabilities: {
      lines: nonCurrentLiabAccts.map((b) => line(b, creditNet(b))),
      total: formatCents(nonCurrentLiabTotal),
    },
    totalLiabilities: formatCents(totalLiabilities),
    equity: {
      lines: equityAccts.map((b) => line(b, creditNet(b))),
      priorEarnings: priorEarnings !== 0n ? formatCents(priorEarnings) : null,
      currentYearProfit: formatCents(currentYearProfit),
      total: formatCents(totalEquity),
    },
    totalLiabilitiesAndEquity: formatCents(totalLE),
    balanced: difference === 0n,
    difference: formatCents(difference),
  };
}

// ===========================================================================
// Cash Flow — Indirect method (spec 11.3)
// ===========================================================================

export type CFLine = { label: string; amount: string };
export type CashFlow = {
  from: string;
  to: string;
  operating: { netProfit: string; lines: CFLine[]; total: string };
  investing: { lines: CFLine[]; total: string };
  financing: { lines: CFLine[]; total: string };
  netChange: string;
  openingCash: string;
  closingCash: string;
  reconciles: boolean;
};

export async function getCashFlow(entityId: string, from: string, to: string): Promise<CashFlow> {
  const period = await accountBalances(entityId, from, to);
  const openingBalances = await accountBalances(entityId, MIN_DATE, dayBefore(from));
  const closingBalances = await accountBalances(entityId, MIN_DATE, to);

  const cashSum = (balances: Balance[]) =>
    balances.filter(isCash).reduce((s, b) => s + debitNet(b), 0n);
  const openingCash = cashSum(openingBalances);
  const closingCash = cashSum(closingBalances);

  // Sum (credit - debit) over accounts matching a predicate, for the period.
  const flow = (pred: (b: Balance) => boolean) =>
    period.filter(pred).reduce((s, b) => s + creditNet(b), 0n);

  // --- Operating ---
  const profit = netIncome(period);
  const depreciationAddBack = flow(isContraAsset); // accum. depreciation increase (credit)
  const receivables = flow(
    (b) => b.type === "asset" && !isCash(b) && num(b) < 1500 && (b.subType === "receivable" || (num(b) >= 1200 && num(b) < 1300))
  );
  const inventory = flow(
    (b) => b.type === "asset" && !isCash(b) && num(b) < 1500 && (b.subType === "inventory" || (num(b) >= 1300 && num(b) < 1400))
  );
  const otherCurrentAssets = flow(
    (b) =>
      b.type === "asset" &&
      !isCash(b) &&
      num(b) < 1500 &&
      !(b.subType === "receivable" || (num(b) >= 1200 && num(b) < 1300)) &&
      !(b.subType === "inventory" || (num(b) >= 1300 && num(b) < 1400))
  );
  const payables = flow(
    (b) => b.type === "liability" && num(b) < 2500 && (b.subType === "payable" || (num(b) >= 2100 && num(b) < 2200))
  );
  const otherCurrentLiabilities = flow(
    (b) =>
      b.type === "liability" &&
      num(b) < 2500 &&
      !(b.subType === "payable" || (num(b) >= 2100 && num(b) < 2200))
  );

  const operatingLines: CFLine[] = [
    { label: "Depreciation & amortisation", amount: formatCents(depreciationAddBack) },
    { label: "(Increase)/decrease in receivables", amount: formatCents(receivables) },
    { label: "(Increase)/decrease in inventory", amount: formatCents(inventory) },
    { label: "(Increase)/decrease in other current assets", amount: formatCents(otherCurrentAssets) },
    { label: "Increase/(decrease) in payables", amount: formatCents(payables) },
    { label: "Increase/(decrease) in other current liabilities", amount: formatCents(otherCurrentLiabilities) },
  ].filter((l) => l.amount !== "0.00");

  const operatingTotal =
    profit +
    depreciationAddBack +
    receivables +
    inventory +
    otherCurrentAssets +
    payables +
    otherCurrentLiabilities;

  // --- Investing --- non-current assets excluding contra (accum. depreciation)
  const nonCurrentAssetAccts = period.filter(
    (b) => b.type === "asset" && num(b) >= 1500 && !isContraAsset(b)
  );
  const investingLines: CFLine[] = nonCurrentAssetAccts
    .map((b) => ({ label: `Net movement in ${b.name}`, amount: formatCents(creditNet(b)) }))
    .filter((l) => l.amount !== "0.00");
  const investingTotal = nonCurrentAssetAccts.reduce((s, b) => s + creditNet(b), 0n);

  // --- Financing --- non-current liabilities + equity accounts
  const financingAccts = period.filter(
    (b) => (b.type === "liability" && num(b) >= 2500) || b.type === "equity"
  );
  const financingLines: CFLine[] = financingAccts
    .map((b) => ({ label: `Net movement in ${b.name}`, amount: formatCents(creditNet(b)) }))
    .filter((l) => l.amount !== "0.00");
  const financingTotal = financingAccts.reduce((s, b) => s + creditNet(b), 0n);

  const netChange = operatingTotal + investingTotal + financingTotal;

  return {
    from,
    to,
    operating: { netProfit: formatCents(profit), lines: operatingLines, total: formatCents(operatingTotal) },
    investing: { lines: investingLines, total: formatCents(investingTotal) },
    financing: { lines: financingLines, total: formatCents(financingTotal) },
    netChange: formatCents(netChange),
    openingCash: formatCents(openingCash),
    closingCash: formatCents(closingCash),
    reconciles: netChange === closingCash - openingCash,
  };
}

// ===========================================================================
// Statement of Changes in Equity (Phase 7)
// ===========================================================================

export type EquityChangeRow = {
  number: string | null; // null for the accumulated-profit row
  name: string;
  opening: string;
  movements: string;
  closing: string;
};

export type ChangesInEquity = {
  from: string;
  to: string;
  rows: EquityChangeRow[];
  totalOpening: string;
  totalMovements: string;
  totalClosing: string;
};

/**
 * Per equity component: opening balance, movements in the window, closing.
 * The "Accumulated profits" row carries all P&L activity not yet closed to
 * retained earnings, so the totals row ALWAYS equals the balance sheet's
 * equity total at the same dates.
 */
export async function getChangesInEquity(
  entityId: string,
  from: string,
  to: string
): Promise<ChangesInEquity> {
  const opening = await accountBalances(entityId, MIN_DATE, dayBefore(from));
  const period = await accountBalances(entityId, from, to);
  const closing = await accountBalances(entityId, MIN_DATE, to);

  const byId = (list: Balance[]) => new Map(list.map((b) => [b.id, b]));
  const openingBy = byId(opening);
  const periodBy = byId(period);

  const rows: EquityChangeRow[] = [];
  let totalOpening = 0n;
  let totalMovements = 0n;
  let totalClosing = 0n;

  for (const b of closing.filter((x) => x.type === "equity")) {
    const open = creditNet(openingBy.get(b.id) ?? { ...b, debit: 0n, credit: 0n });
    const move = creditNet(periodBy.get(b.id) ?? { ...b, debit: 0n, credit: 0n });
    const close = creditNet(b);
    if (open === 0n && move === 0n && close === 0n) continue;
    rows.push({
      number: b.number,
      name: b.name,
      opening: formatCents(open),
      movements: formatCents(move),
      closing: formatCents(close),
    });
    totalOpening += open;
    totalMovements += move;
    totalClosing += close;
  }

  // P&L activity not yet swept to retained earnings by a year-end close
  const plOpening = netIncome(opening);
  const plMovement = netIncome(period);
  const plClosing = netIncome(closing);
  if (plOpening !== 0n || plMovement !== 0n || plClosing !== 0n) {
    rows.push({
      number: null,
      name: "Accumulated profits (not yet closed)",
      opening: formatCents(plOpening),
      movements: formatCents(plMovement),
      closing: formatCents(plClosing),
    });
    totalOpening += plOpening;
    totalMovements += plMovement;
    totalClosing += plClosing;
  }

  return {
    from,
    to,
    rows,
    totalOpening: formatCents(totalOpening),
    totalMovements: formatCents(totalMovements),
    totalClosing: formatCents(totalClosing),
  };
}

// ===========================================================================
// Comparative P&L (Phase 7) — same window, one year earlier
// ===========================================================================

export type ComparativePL = {
  current: ProfitAndLoss;
  prior: ProfitAndLoss;
};

function shiftYear(date: string, delta: number): string {
  const y = Number(date.slice(0, 4)) + delta;
  const rest = date.slice(4);
  // clamp Feb 29 -> Feb 28 on non-leap targets
  if (rest === "-02-29") {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (!leap) return `${y}-02-28`;
  }
  return `${y}${rest}`;
}

export async function getComparativePL(
  entityId: string,
  from: string,
  to: string
): Promise<ComparativePL> {
  const [current, prior] = await Promise.all([
    getProfitAndLoss(entityId, from, to),
    getProfitAndLoss(entityId, shiftYear(from, -1), shiftYear(to, -1)),
  ]);
  return { current, prior };
}

// Shared default-range helper for the pages
export function defaultFiscalRange(asOf: string, fyStartMonth: number): { from: string; to: string } {
  return { from: fiscalYearStart(asOf, fyStartMonth), to: asOf };
}
