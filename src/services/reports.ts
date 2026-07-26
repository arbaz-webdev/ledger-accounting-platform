import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { parseCents, formatCents } from "@/lib/money";
import { resolveMapping } from "@/services/mappings";

/**
 * Reports are LIVE queries over the ledger (spec 16.2 rules 7 & 9).
 * No snapshots, no caches.
 *
 * Status filter: 'posted' AND 'voided' are included. Voiding always creates a
 * posted reversal (spec 16.2 rule 5), so the voided original and its reversal
 * cancel to zero — excluding only the original would leave the reversal
 * dangling and misstate every report. Draft / pending entries are excluded.
 * (Spec 4.3 shows Voided as "Reversed" in reports, which this implements;
 * flag for accountant sign-off.)
 */

export type TrialBalanceRow = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
  debit: string; // net debit balance, "0.00" if credit-side
  credit: string; // net credit balance, "0.00" if debit-side
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebits: string;
  totalCredits: string;
  balanced: boolean;
};

/** Trial balance as at a date: cumulative posted activity per account. */
export async function getTrialBalance(entityId: string, asOf: string): Promise<TrialBalance> {
  const result = await db.execute(sql`
    SELECT
      a.id AS account_id,
      a.account_number,
      a.name AS account_name,
      a.type AS account_type,
      COALESCE(SUM(l.debit_base), 0)  AS total_debit,
      COALESCE(SUM(l.credit_base), 0) AS total_credit
    FROM chart_of_accounts a
    JOIN journal_entry_lines l ON l.account_id = a.id
    JOIN journal_entries je ON je.id = l.je_id
    WHERE a.entity_id = ${entityId}
      AND je.status IN ('posted', 'voided')
      AND je.date <= ${asOf}
    GROUP BY a.id, a.account_number, a.name, a.type
    HAVING COALESCE(SUM(l.debit_base), 0) <> COALESCE(SUM(l.credit_base), 0)
    ORDER BY a.account_number
  `);

  let totalDebits = 0n;
  let totalCredits = 0n;

  const rows: TrialBalanceRow[] = (
    result.rows as {
      account_id: string;
      account_number: string;
      account_name: string;
      account_type: string;
      total_debit: string;
      total_credit: string;
    }[]
  ).map((r) => {
    const net = parseCents(r.total_debit) - parseCents(r.total_credit);
    if (net >= 0n) totalDebits += net;
    else totalCredits += -net;
    return {
      accountId: r.account_id,
      accountNumber: r.account_number,
      accountName: r.account_name,
      accountType: r.account_type,
      debit: net > 0n ? formatCents(net) : "0.00",
      credit: net < 0n ? formatCents(-net) : "0.00",
    };
  });

  return {
    rows,
    totalDebits: formatCents(totalDebits),
    totalCredits: formatCents(totalCredits),
    balanced: totalDebits === totalCredits,
  };
}

export type LedgerLine = {
  date: string;
  jeId: string;
  jeNumber: number;
  description: string;
  reference: string | null;
  debit: string;
  credit: string;
  runningBalance: string; // signed: positive = debit balance
};

export type LedgerReport = {
  openingBalance: string;
  closingBalance: string;
  lines: LedgerLine[];
};

/** General ledger for one account: opening balance, movements, running balance (spec 8.2). */
export async function getGeneralLedger(
  entityId: string,
  accountId: string,
  from: string,
  to: string
): Promise<LedgerReport> {
  const opening = await db.execute(sql`
    SELECT COALESCE(SUM(l.debit_base - l.credit_base), 0) AS bal
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.je_id
    WHERE l.account_id = ${accountId}
      AND je.entity_id = ${entityId}
      AND je.status IN ('posted', 'voided')
      AND je.date < ${from}
  `);
  const openingBal = Number((opening.rows[0] as { bal: string }).bal);

  const movements = await db.execute(sql`
    SELECT je.date, je.id AS je_id, je.je_number, je.description, je.reference,
           l.debit_base AS debit, l.credit_base AS credit, l.line_no
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.je_id
    WHERE l.account_id = ${accountId}
      AND je.entity_id = ${entityId}
      AND je.status IN ('posted', 'voided')
      AND je.date >= ${from}
      AND je.date <= ${to}
    ORDER BY je.date, je.je_number, l.line_no
  `);

  let running = Math.round(openingBal * 100);
  const lines: LedgerLine[] = (
    movements.rows as {
      date: string;
      je_id: string;
      je_number: number;
      description: string;
      reference: string | null;
      debit: string;
      credit: string;
    }[]
  ).map((r) => {
    const debit = Math.round(Number(r.debit) * 100);
    const credit = Math.round(Number(r.credit) * 100);
    running += debit - credit;
    return {
      date: String(r.date).slice(0, 10),
      jeId: r.je_id,
      jeNumber: Number(r.je_number),
      description: r.description,
      reference: r.reference,
      debit: (debit / 100).toFixed(2),
      credit: (credit / 100).toFixed(2),
      runningBalance: (running / 100).toFixed(2),
    };
  });

  return {
    openingBalance: openingBal.toFixed(2),
    closingBalance: (running / 100).toFixed(2),
    lines,
  };
}

// ===========================================================================
// Tax Summary (Phase 7) — output vs input tax for a filing period
// ===========================================================================

export type TaxSummaryMonth = {
  month: string; // YYYY-MM
  outputTax: string;
  inputTax: string;
  net: string;
};

export type TaxSummary = {
  from: string;
  to: string;
  months: TaxSummaryMonth[];
  totalOutput: string;
  totalInput: string;
  totalNet: string; // positive = owed to the tax authority
  outputAccount: string;
  inputAccount: string;
};

export async function getTaxSummary(entityId: string, from: string, to: string): Promise<TaxSummary> {
  const outputId = await resolveMapping(entityId, "sales_tax_payable");
  const inputId = await resolveMapping(entityId, "input_tax");

  const nameRows = await db.execute(sql`
    SELECT id, account_number, name FROM chart_of_accounts WHERE id IN (${outputId}, ${inputId})
  `);
  const names = new Map(
    (nameRows.rows as { id: string; account_number: string; name: string }[]).map((r) => [
      r.id,
      `${r.account_number} — ${r.name}`,
    ])
  );

  const result = await db.execute(sql`
    SELECT to_char(date_trunc('month', je.date), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN l.account_id = ${outputId} THEN l.credit_base - l.debit_base ELSE 0 END), 0) AS output_tax,
      COALESCE(SUM(CASE WHEN l.account_id = ${inputId}  THEN l.debit_base - l.credit_base ELSE 0 END), 0) AS input_tax
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.je_id
    WHERE je.entity_id = ${entityId}
      AND je.status IN ('posted', 'voided')
      AND l.account_id IN (${outputId}, ${inputId})
      AND je.date >= ${from} AND je.date <= ${to}
    GROUP BY 1
    ORDER BY 1
  `);

  let totalOutput = 0n;
  let totalInput = 0n;
  const months = (result.rows as { month: string; output_tax: string; input_tax: string }[]).map(
    (r) => {
      const out = parseCents(r.output_tax);
      const inp = parseCents(r.input_tax);
      totalOutput += out;
      totalInput += inp;
      return {
        month: r.month,
        outputTax: formatCents(out),
        inputTax: formatCents(inp),
        net: formatCents(out - inp),
      };
    }
  );

  return {
    from,
    to,
    months,
    totalOutput: formatCents(totalOutput),
    totalInput: formatCents(totalInput),
    totalNet: formatCents(totalOutput - totalInput),
    outputAccount: names.get(outputId) ?? "Sales tax payable",
    inputAccount: names.get(inputId) ?? "Input tax receivable",
  };
}

// ===========================================================================
// Day Book (Phase 7) — chronological journal listing
// ===========================================================================

export type DayBookRow = {
  jeId: string;
  jeNumber: number | null;
  date: string;
  description: string;
  reference: string | null;
  sourceModule: string;
  status: string;
  total: string; // sum of debits (= sum of credits)
};

export type DayBook = {
  from: string;
  to: string;
  rows: DayBookRow[];
  grandTotal: string;
  count: number;
  truncated: boolean;
};

const DAY_BOOK_LIMIT = 500;

export async function getDayBook(entityId: string, from: string, to: string): Promise<DayBook> {
  const result = await db.execute(sql`
    SELECT je.id, je.je_number, je.date, je.description, je.reference,
           je.source_module, je.status,
           COALESCE(SUM(l.debit_base), 0) AS total
    FROM journal_entries je
    JOIN journal_entry_lines l ON l.je_id = je.id
    WHERE je.entity_id = ${entityId}
      AND je.status IN ('posted', 'voided')
      AND je.date >= ${from} AND je.date <= ${to}
    GROUP BY je.id
    ORDER BY je.date, je.je_number
    LIMIT ${DAY_BOOK_LIMIT + 1}
  `);

  const raw = result.rows as {
    id: string;
    je_number: number | null;
    date: string;
    description: string;
    reference: string | null;
    source_module: string;
    status: string;
    total: string;
  }[];
  const truncated = raw.length > DAY_BOOK_LIMIT;
  const page = truncated ? raw.slice(0, DAY_BOOK_LIMIT) : raw;

  let grand = 0n;
  const rows = page.map((r) => {
    const total = parseCents(r.total);
    grand += total;
    return {
      jeId: r.id,
      jeNumber: r.je_number,
      date: String(r.date).slice(0, 10),
      description: r.description,
      reference: r.reference,
      sourceModule: r.source_module,
      status: r.status,
      total: formatCents(total),
    };
  });

  return { from, to, rows, grandTotal: formatCents(grand), count: rows.length, truncated };
}
