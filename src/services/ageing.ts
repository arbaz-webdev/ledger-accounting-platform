import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { parseCents, formatCents } from "@/lib/money";
import { resolveMapping } from "@/services/mappings";

/**
 * AR / AP Ageing (spec 6.2 and 7.2) — live reads, never stored reports.
 * Buckets: Current (not yet due), 1-30, 31-60, 61-90, 90+ days overdue.
 *
 * Also reconciles the subsidiary ledger (open documents) against the GL control
 * account. A difference means journal entries were posted directly to the
 * control account, bypassing the invoice/bill modules — worth surfacing.
 */

export const BUCKET_LABELS = ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"] as const;
export type BucketIndex = 0 | 1 | 2 | 3 | 4;

export type AgeingRow = {
  documentId: string;
  documentNumber: string;
  contactName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  /** base currency — what ties to the GL control account */
  outstanding: string;
  /** document currency + amount, for display when it differs from base */
  currency: string;
  outstandingDoc: string;
  bucket: BucketIndex;
};

export type AgeingReport = {
  asOf: string;
  rows: AgeingRow[];
  bucketTotals: string[];
  total: string;
  /** GL control account balance as at the same date */
  controlBalance: string;
  /** subsidiary total − control balance; non-zero means direct JEs to the control account */
  difference: string;
  tiesOut: boolean;
  controlAccountLabel: string;
};

function bucketFor(daysOverdue: number): BucketIndex {
  if (daysOverdue <= 0) return 0;
  if (daysOverdue <= 30) return 1;
  if (daysOverdue <= 60) return 2;
  if (daysOverdue <= 90) return 3;
  return 4;
}

async function buildAgeing(
  entityId: string,
  asOf: string,
  kind: "ar" | "ap"
): Promise<AgeingReport> {
  const isAr = kind === "ar";

  // Open documents with outstanding balance as at `asOf`
  // Open balances are converted to BASE currency at the DOCUMENT's rate —
  // the rate the control account was loaded at — so the tie-out below stays
  // exact even with foreign-currency documents.
  const rows = isAr
    ? await db.execute(sql`
        SELECT i.id, i.invoice_number AS number, i.issue_date, i.due_date, i.total,
               i.currency, i.fx_rate,
               c.name AS contact_name,
               COALESCE((SELECT SUM(s.amount) FROM settlements s
                         WHERE s.invoice_id = i.id AND s.date <= ${asOf}), 0) AS settled
        FROM invoices i
        JOIN contacts c ON c.id = i.customer_id
        WHERE i.entity_id = ${entityId}
          AND i.status IN ('posted', 'paid')
          AND i.issue_date <= ${asOf}
        ORDER BY i.due_date
      `)
    : await db.execute(sql`
        SELECT b.id, b.bill_number AS number, b.issue_date, b.due_date, b.total,
               b.currency, b.fx_rate,
               c.name AS contact_name,
               COALESCE((SELECT SUM(s.amount) FROM settlements s
                         WHERE s.bill_id = b.id AND s.date <= ${asOf}), 0) AS settled
        FROM bills b
        JOIN contacts c ON c.id = b.supplier_id
        WHERE b.entity_id = ${entityId}
          AND b.status IN ('posted', 'paid')
          AND b.issue_date <= ${asOf}
        ORDER BY b.due_date
      `);

  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const bucketTotals = [0n, 0n, 0n, 0n, 0n];
  let total = 0n;
  const out: AgeingRow[] = [];

  for (const r of rows.rows as {
    id: string;
    number: string;
    issue_date: string;
    due_date: string;
    total: string;
    currency: string;
    fx_rate: string;
    contact_name: string;
    settled: string;
  }[]) {
    const outstandingDoc = parseCents(r.total) - parseCents(r.settled);
    if (outstandingDoc <= 0n) continue; // fully settled — not an open item
    // Convert to base at the document's rate (rate is 1 for base-currency docs)
    const rate = Number(r.fx_rate);
    const outstanding =
      rate === 1
        ? outstandingDoc
        : BigInt(Math.round(Number(outstandingDoc) * rate));

    const dueDate = String(r.due_date).slice(0, 10);
    const daysOverdue = Math.floor((asOfMs - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
    const bucket = bucketFor(daysOverdue);

    bucketTotals[bucket] += outstanding;
    total += outstanding;
    out.push({
      documentId: r.id,
      documentNumber: r.number,
      contactName: r.contact_name,
      issueDate: String(r.issue_date).slice(0, 10),
      dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      outstanding: formatCents(outstanding),
      currency: r.currency,
      outstandingDoc: formatCents(outstandingDoc),
      bucket,
    });
  }

  // GL control account balance as at the same date
  const controlAccountId = await resolveMapping(entityId, isAr ? "ar_control" : "ap_control");
  const controlRows = await db.execute(sql`
    SELECT a.account_number, a.name,
           COALESCE(SUM(l.debit_base - l.credit_base), 0) AS net
    FROM chart_of_accounts a
    LEFT JOIN journal_entry_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = l.je_id
      AND je.status IN ('posted', 'voided') AND je.date <= ${asOf}
    WHERE a.id = ${controlAccountId}
    GROUP BY a.account_number, a.name
  `);
  const control = controlRows.rows[0] as
    | { account_number: string; name: string; net: string }
    | undefined;
  // AR is debit-normal, AP credit-normal — show both as positive balances
  const controlNet = parseCents(control?.net ?? "0");
  const controlBalance = isAr ? controlNet : -controlNet;
  const difference = total - controlBalance;

  return {
    asOf,
    rows: out,
    bucketTotals: bucketTotals.map(formatCents),
    total: formatCents(total),
    controlBalance: formatCents(controlBalance),
    difference: formatCents(difference),
    tiesOut: difference === 0n,
    controlAccountLabel: control ? `${control.account_number} · ${control.name}` : "—",
  };
}

export function getArAgeing(entityId: string, asOf: string) {
  return buildAgeing(entityId, asOf, "ar");
}

export function getApAgeing(entityId: string, asOf: string) {
  return buildAgeing(entityId, asOf, "ap");
}
