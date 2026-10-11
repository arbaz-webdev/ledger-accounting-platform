import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getProfitAndLoss } from "@/services/statements";
import { formatCents, parseCents } from "@/lib/money";

export async function clientCashBalances(firmId: string, asOf: string) {
  const result = await db.execute(sql`
    SELECT e.id, e.name, e.base_currency,
      COALESCE((SELECT SUM(l.debit_base-l.credit_base)
        FROM journal_entries je JOIN journal_entry_lines l ON l.je_id=je.id
        JOIN chart_of_accounts a ON a.id=l.account_id
        WHERE je.entity_id=e.id AND je.status IN ('posted','voided')
          AND je.date<=${asOf} AND a.type='asset' AND a.sub_type='cash_and_bank'),0) AS cash_balance
    FROM entities e WHERE e.firm_id=${firmId} AND e.is_active AND NOT e.is_firm_books
    ORDER BY e.name
  `);
  return result.rows as { id: string; name: string; base_currency: string; cash_balance: string }[];
}

export async function contractedClientFees(firmId: string) {
  const result = await db.execute(sql`
    SELECT e.id, e.name, m.managed_by, m.monthly_fee, m.currency, m.renewal_on
    FROM client_subscription_management m JOIN entities e ON e.id=m.entity_id
    WHERE e.firm_id=${firmId} AND e.is_active AND NOT e.is_firm_books
    ORDER BY e.name
  `);
  return result.rows as { id: string; name: string; managed_by: "firm" | "client"; monthly_fee: string; currency: string; renewal_on: string | null }[];
}

export async function firmMonthlyPerformance(firmBooksId: string, asOf: string, months = 6) {
  const year = Number(asOf.slice(0,4)), month = Number(asOf.slice(5,7));
  const dates = Array.from({length: months}, (_, i) => {
    const d = new Date(Date.UTC(year, month - months + i, 1));
    const start = d.toISOString().slice(0,10);
    const endDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).toISOString().slice(0,10);
    return { label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }), from: start, to: endDate > asOf ? asOf : endDate };
  });
  return Promise.all(dates.map(async date => {
    const report = await getProfitAndLoss(firmBooksId, date.from, date.to);
    const revenue = parseCents(report.revenue.net) + parseCents(report.otherIncome.total);
    const expenses = parseCents(report.cogs.net) + parseCents(report.operatingExpenses.total)
      + parseCents(report.otherExpense.total) + parseCents(report.incomeTax.total);
    return { ...date, revenue: formatCents(revenue), expenses: formatCents(expenses), profit: report.netProfit };
  }));
}

export async function firmActivitySummary(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM entities WHERE firm_id=${firmId} AND NOT is_firm_books AND created_at::date BETWEEN ${from} AND ${to}) AS clients_added,
      (SELECT COUNT(*)::int FROM audit_log a JOIN users u ON u.id=a.user_id WHERE u.firm_id=${firmId}
        AND a.action='CLIENT_ARCHIVED' AND a.created_at::date BETWEEN ${from} AND ${to}) AS clients_archived,
      (SELECT COUNT(*)::int FROM journal_entries je JOIN entities e ON e.id=je.entity_id WHERE e.firm_id=${firmId}
        AND NOT e.is_firm_books AND je.status='posted' AND je.date BETWEEN ${from} AND ${to}) AS client_entries,
      (SELECT COUNT(*)::int FROM journal_entries je JOIN entities e ON e.id=je.entity_id WHERE e.firm_id=${firmId}
        AND NOT e.is_firm_books AND je.status='pending_approval') AS pending_approvals,
      (SELECT COUNT(*)::int FROM invoices i JOIN entities e ON e.id=i.entity_id WHERE e.firm_id=${firmId}
        AND NOT e.is_firm_books AND i.status='posted' AND i.due_date<CURRENT_DATE
        AND i.total>COALESCE((SELECT SUM(s.amount) FROM settlements s WHERE s.invoice_id=i.id),0)) AS overdue_invoices
  `);
  return result.rows[0] as { clients_added: number; clients_archived: number; client_entries: number; pending_approvals: number; overdue_invoices: number };
}

export async function staffWorkload(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`
    SELECT u.id, u.full_name, u.role, u.is_active,
      COUNT(je.id)::int AS posted_entries,
      COUNT(DISTINCT je.entity_id)::int AS clients_touched
    FROM users u LEFT JOIN journal_entries je ON je.created_by=u.id AND je.status='posted'
      AND je.date BETWEEN ${from} AND ${to} AND je.entity_id IN
        (SELECT id FROM entities WHERE firm_id=${firmId} AND NOT is_firm_books)
    WHERE u.firm_id=${firmId}
    GROUP BY u.id,u.full_name,u.role,u.is_active ORDER BY posted_entries DESC,u.full_name
  `);
  return result.rows as { id: string; full_name: string; role: string; is_active: boolean; posted_entries: number; clients_touched: number }[];
}

export async function clientPostingByMonth(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`
    SELECT to_char(je.date,'YYYY-MM') AS month, COUNT(*)::int AS entries
    FROM journal_entries je JOIN entities e ON e.id=je.entity_id
    WHERE e.firm_id=${firmId} AND NOT e.is_firm_books AND je.status='posted' AND je.date BETWEEN ${from} AND ${to}
    GROUP BY 1 ORDER BY 1
  `);
  return result.rows as { month: string; entries: number }[];
}

export async function clientPostingByPeriod(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`
    SELECT e.name AS client_name, to_char(je.date,'YYYY-MM') AS month, COUNT(*)::int AS entries
    FROM journal_entries je JOIN entities e ON e.id=je.entity_id
    WHERE e.firm_id=${firmId} AND NOT e.is_firm_books AND je.status='posted' AND je.date BETWEEN ${from} AND ${to}
    GROUP BY e.id,e.name,to_char(je.date,'YYYY-MM') ORDER BY month DESC,e.name LIMIT 250
  `);
  return result.rows as { client_name: string; month: string; entries: number }[];
}

export async function firmUserActivity(firmId: string, limit = 50) {
  const result = await db.execute(sql`
    SELECT a.created_at, a.action, a.table_name, u.full_name, e.name AS client_name
    FROM audit_log a JOIN users u ON u.id=a.user_id
    LEFT JOIN entities e ON e.id=a.entity_id
    WHERE u.firm_id=${firmId} AND (e.id IS NULL OR e.firm_id=${firmId})
    ORDER BY a.created_at DESC LIMIT ${Math.min(200,Math.max(1,limit))}
  `);
  return result.rows as { created_at: Date; action: string; table_name: string | null; full_name: string; client_name: string | null }[];
}

export async function periodCloseTurnaround(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`
    SELECT e.name AS client_name, p.year, p.month, p.locked_at,
      (p.locked_at::date - (make_date(p.year,p.month,1) + INTERVAL '1 month - 1 day')::date)::int AS days_after_month_end
    FROM periods p JOIN entities e ON e.id=p.entity_id
    WHERE e.firm_id=${firmId} AND NOT e.is_firm_books AND p.locked_at IS NOT NULL
      AND p.locked_at::date BETWEEN ${from} AND ${to}
    ORDER BY p.locked_at DESC LIMIT 100
  `);
  return result.rows as { client_name: string; year: number; month: number; locked_at: Date; days_after_month_end: number }[];
}
