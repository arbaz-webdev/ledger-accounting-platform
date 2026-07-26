import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveMapping } from "@/services/mappings";
import { getArAgeing, getApAgeing } from "@/services/ageing";
import { inventoryGlTieOut } from "@/services/inventory";

/**
 * Month-end pre-close checks (advisory, per user decision): locking a period
 * surfaces everything an accountant would want cleared first, but never blocks
 * — the lock itself stays their call. Every check is a plain read; nothing
 * here mutates state.
 */

export type CloseCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** what to show next to a failing check */
  detail: string;
  /** where to go to fix it (entity-relative path) */
  fixPath?: string;
};

export function periodRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

async function countScalar(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  return Number((res.rows[0] as { n: string | number }).n);
}

export async function preCloseChecks(
  entityId: string,
  year: number,
  month: number
): Promise<CloseCheck[]> {
  const { from, to } = periodRange(year, month);
  const checks: CloseCheck[] = [];

  // 1. Unposted journal entries dated in the period
  const draftJes = await countScalar(sql`
    SELECT COUNT(*) AS n FROM journal_entries
    WHERE entity_id = ${entityId} AND status IN ('draft', 'pending_approval')
      AND date >= ${from} AND date <= ${to}
  `);
  checks.push({
    key: "draft_jes",
    label: "No draft journal entries dated in the period",
    ok: draftJes === 0,
    detail: draftJes ? `${draftJes} draft ${draftJes === 1 ? "entry" : "entries"} — post or discard them` : "",
    fixPath: "/journal",
  });

  // 2. Draft invoices / bills issued in the period
  const draftInvoices = await countScalar(sql`
    SELECT COUNT(*) AS n FROM invoices
    WHERE entity_id = ${entityId} AND status = 'draft'
      AND issue_date >= ${from} AND issue_date <= ${to}
  `);
  checks.push({
    key: "draft_invoices",
    label: "No draft invoices issued in the period",
    ok: draftInvoices === 0,
    detail: draftInvoices ? `${draftInvoices} draft invoice${draftInvoices === 1 ? "" : "s"}` : "",
    fixPath: "/sales",
  });

  const draftBills = await countScalar(sql`
    SELECT COUNT(*) AS n FROM bills
    WHERE entity_id = ${entityId} AND status = 'draft'
      AND issue_date >= ${from} AND issue_date <= ${to}
  `);
  checks.push({
    key: "draft_bills",
    label: "No draft bills issued in the period",
    ok: draftBills === 0,
    detail: draftBills ? `${draftBills} draft bill${draftBills === 1 ? "" : "s"}` : "",
    fixPath: "/purchases",
  });

  // 3. Draft pay runs paying in the period
  const draftPayRuns = await countScalar(sql`
    SELECT COUNT(*) AS n FROM pay_runs
    WHERE entity_id = ${entityId} AND status = 'draft'
      AND pay_date >= ${from} AND pay_date <= ${to}
  `);
  checks.push({
    key: "draft_pay_runs",
    label: "No draft pay runs dated in the period",
    ok: draftPayRuns === 0,
    detail: draftPayRuns ? `${draftPayRuns} draft pay run${draftPayRuns === 1 ? "" : "s"}` : "",
    fixPath: "/payroll",
  });

  // 4. Imported bank rows still waiting in the review queue
  const pendingBankRows = await countScalar(sql`
    SELECT COUNT(*) AS n FROM bank_transactions
    WHERE entity_id = ${entityId} AND status IN ('pending', 'categorised')
      AND txn_date >= ${from} AND txn_date <= ${to}
  `);
  checks.push({
    key: "bank_queue",
    label: "No imported bank transactions awaiting posting",
    ok: pendingBankRows === 0,
    detail: pendingBankRows ? `${pendingBankRows} unposted row${pendingBankRows === 1 ? "" : "s"} in the review queue` : "",
    fixPath: "/banking/review",
  });

  // 5. Suspense account clear as at period end
  let suspenseBalance = new Decimal(0);
  try {
    const suspenseId = await resolveMapping(entityId, "suspense");
    const res = await db.execute(sql`
      SELECT COALESCE(SUM(l.debit_base - l.credit_base), 0) AS bal
      FROM journal_entry_lines l
      JOIN journal_entries je ON je.id = l.je_id
      WHERE l.account_id = ${suspenseId}
        AND je.status IN ('posted', 'voided') AND je.date <= ${to}
    `);
    suspenseBalance = new Decimal(String((res.rows[0] as { bal: string }).bal));
  } catch {
    // no suspense mapping — treat as clear
  }
  checks.push({
    key: "suspense",
    label: "Suspense account is clear at period end",
    ok: suspenseBalance.isZero(),
    detail: suspenseBalance.isZero() ? "" : `Suspense balance ${suspenseBalance.toFixed(2)} — reclassify before closing`,
    fixPath: "/reports/ledger",
  });

  // 6. Subsidiary ledgers tie to their control accounts as at period end
  const ar = await getArAgeing(entityId, to);
  checks.push({
    key: "ar_tieout",
    label: "AR subledger ties to the control account",
    ok: ar.tiesOut,
    detail: ar.tiesOut ? "" : `Difference ${ar.difference} between open invoices and the AR control account`,
    fixPath: "/reports/ar-ageing",
  });

  const ap = await getApAgeing(entityId, to);
  checks.push({
    key: "ap_tieout",
    label: "AP subledger ties to the control account",
    ok: ap.tiesOut,
    detail: ap.tiesOut ? "" : `Difference ${ap.difference} between open bills and the AP control account`,
    fixPath: "/reports/ap-ageing",
  });

  // 7. Inventory subledger ties to the GL (current state — lots have no as-at
  //    history, so this is a present-day check)
  const inv = await inventoryGlTieOut(entityId);
  checks.push({
    key: "inventory_tieout",
    label: "Inventory subledger ties to the GL (current)",
    ok: inv.inBalance,
    detail: inv.inBalance ? "" : `Difference ${inv.difference} between stock value and ${inv.account}`,
    fixPath: "/inventory",
  });

  // 8. A bank reconciliation was approved for the period (informational)
  const recs = await countScalar(sql`
    SELECT COUNT(*) AS n FROM bank_reconciliations
    WHERE entity_id = ${entityId}
      AND statement_date >= ${from} AND statement_date <= ${to}
  `);
  checks.push({
    key: "bank_rec",
    label: "A bank reconciliation was approved for the period",
    ok: recs > 0,
    detail: recs > 0 ? "" : "No approved reconciliation with a statement date in this month",
    fixPath: "/banking/reconcile",
  });

  return checks;
}
