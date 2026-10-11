import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getTrialBalance, getDayBook } from "@/services/reports";
import { listItems } from "@/services/inventory";

export const PORTAL_REPORTS = {
  "trial-balance": { title: "Trial Balance", description: "Debit and credit balances across the chart of accounts." },
  "journal-report": { title: "Journal Report", description: "Chronological posted and reversing journal entries." },
  "sales-by-customer": { title: "Sales by Customer", description: "Invoice revenue and customer contribution." },
  "purchases-by-vendor": { title: "Purchases by Vendor", description: "Supplier spend over the selected period." },
  "expenses-by-category": { title: "Expenses by Category", description: "Posted expense balances by account." },
  "inventory-valuation": { title: "Inventory Valuation", description: "Current stock quantity and remaining book value." },
} as const;

export type PortalReportSlug = keyof typeof PORTAL_REPORTS;

export async function getPortalCatalogReport(entityId: string, slug: PortalReportSlug, from: string, to: string) {
  let headers: string[] = [];
  let rows: string[][] = [];
  switch (slug) {
    case "trial-balance": {
      const data = await getTrialBalance(entityId, to);
      headers = ["Account", "Name", "Type", "Debit", "Credit"];
      rows = data.rows.map((row) => [row.accountNumber, row.accountName, row.accountType, row.debit, row.credit]);
      rows.push(["", "Total", "", data.totalDebits, data.totalCredits]);
      break;
    }
    case "journal-report": {
      const data = await getDayBook(entityId, from, to);
      headers = ["Date", "Journal", "Source", "Description", "Reference", "Status", "Total"];
      rows = data.rows.map((row) => [row.date, String(row.jeNumber ?? ""), row.sourceModule, row.description, row.reference ?? "", row.status, row.total]);
      break;
    }
    case "sales-by-customer": {
      const result = await db.execute(sql`
        SELECT c.name, COUNT(i.id)::int AS documents, COALESCE(SUM(i.total),0) AS amount
        FROM contacts c JOIN invoices i ON i.customer_id=c.id
        JOIN journal_entries original ON original.id=i.je_id AND original.status IN ('posted','voided')
        LEFT JOIN journal_entries reversal ON reversal.id=original.voided_by_je_id
        WHERE i.entity_id=${entityId} AND i.issue_date BETWEEN ${from} AND ${to}
          AND (reversal.id IS NULL OR reversal.date>${to})
        GROUP BY c.id ORDER BY amount DESC, c.name
      `);
      headers = ["Customer", "Invoices", "Sales"];
      rows = (result.rows as { name: string; documents: number; amount: string }[]).map((row) => [row.name, String(row.documents), row.amount]);
      break;
    }
    case "purchases-by-vendor": {
      const result = await db.execute(sql`
        SELECT c.name, COUNT(b.id)::int AS documents, COALESCE(SUM(b.total),0) AS amount
        FROM contacts c JOIN bills b ON b.supplier_id=c.id
        JOIN journal_entries original ON original.id=b.je_id AND original.status IN ('posted','voided')
        LEFT JOIN journal_entries reversal ON reversal.id=original.voided_by_je_id
        WHERE b.entity_id=${entityId} AND b.issue_date BETWEEN ${from} AND ${to}
          AND (reversal.id IS NULL OR reversal.date>${to})
        GROUP BY c.id ORDER BY amount DESC, c.name
      `);
      headers = ["Supplier", "Bills", "Purchases"];
      rows = (result.rows as { name: string; documents: number; amount: string }[]).map((row) => [row.name, String(row.documents), row.amount]);
      break;
    }
    case "expenses-by-category": {
      const result = await db.execute(sql`
        SELECT a.account_number, a.name, COALESCE(SUM(l.debit_base-l.credit_base),0) AS amount
        FROM chart_of_accounts a JOIN journal_entry_lines l ON l.account_id=a.id
        JOIN journal_entries je ON je.id=l.je_id
        WHERE a.entity_id=${entityId} AND a.type IN ('expense','other_expense')
          AND je.status IN ('posted','voided') AND je.date BETWEEN ${from} AND ${to}
        GROUP BY a.id HAVING SUM(l.debit_base-l.credit_base)<>0
        ORDER BY amount DESC, a.account_number
      `);
      headers = ["Account", "Category", "Amount"];
      rows = (result.rows as { account_number: string; name: string; amount: string }[]).map((row) => [row.account_number, row.name, row.amount]);
      break;
    }
    case "inventory-valuation": {
      const items = await listItems(entityId);
      headers = ["SKU", "Item", "Quantity on hand", "Unit", "Book value"];
      rows = items.filter((item) => !item.isService).map((item) => [item.sku, item.name, item.qtyOnHand, item.unit, item.valueOnHand]);
      break;
    }
  }
  return { headers, rows };
}
