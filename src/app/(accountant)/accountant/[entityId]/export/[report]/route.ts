import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { hasModule, type ModuleKey } from "@/services/permissions";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/csv-export";
import { getTrialBalance, getGeneralLedger, getDayBook, getTaxSummary } from "@/services/reports";
import { getProfitAndLoss, getBalanceSheet, getChangesInEquity } from "@/services/statements";
import { getArAgeing, getApAgeing, BUCKET_LABELS } from "@/services/ageing";
import { listItems } from "@/services/inventory";
import { todayIso } from "@/lib/format";

/**
 * CSV export for every report. Route handlers do NOT inherit route layouts,
 * so the permission check is repeated here explicitly — this endpoint is as
 * privileged as the page it mirrors.
 */

const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(
  request: Request,
  ctx: { params: Promise<{ entityId: string; report: string }> }
) {
  const { entityId, report } = await ctx.params;
  const url = new URL(request.url);

  const user = await requireAccountant();
  try {
    await assertEntityAccess(user, entityId);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const needed: ModuleKey = report === "inventory" ? "inventory" : "reports";
  if (!(await hasModule(user, entityId, needed))) {
    return new Response("Forbidden", { status: 403 });
  }

  const today = todayIso();
  const asOf = isDate(url.searchParams.get("asOf")) ? url.searchParams.get("asOf")! : today;
  const from = isDate(url.searchParams.get("from"))
    ? url.searchParams.get("from")!
    : `${today.slice(0, 4)}-01-01`;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;

  let headers: string[];
  let rows: CsvValue[][];
  let suffix = asOf;

  switch (report) {
    case "trial-balance": {
      const tb = await getTrialBalance(entityId, asOf);
      headers = ["Account number", "Account name", "Type", "Debit", "Credit"];
      rows = tb.rows.map((r) => [
        r.accountNumber,
        r.accountName,
        r.accountType,
        r.debit,
        r.credit,
      ]);
      rows.push(["", "TOTAL", "", tb.totalDebits, tb.totalCredits]);
      break;
    }

    case "general-ledger": {
      const accountId = url.searchParams.get("accountId");
      if (!accountId) return new Response("accountId is required", { status: 400 });
      const gl = await getGeneralLedger(entityId, accountId, from, to);
      headers = ["Date", "JE #", "Reference", "Description", "Debit", "Credit", "Balance"];
      rows = [["", "", "", "Opening balance", "", "", gl.openingBalance]];
      for (const l of gl.lines) {
        rows.push([
          l.date,
          l.jeNumber,
          l.reference ?? "",
          l.description ?? "",
          l.debit,
          l.credit,
          l.runningBalance,
        ]);
      }
      rows.push(["", "", "", "Closing balance", "", "", gl.closingBalance]);
      suffix = `${from}_${to}`;
      break;
    }

    case "day-book": {
      const book = await getDayBook(entityId, from, to);
      headers = ["JE #", "Date", "Description", "Reference", "Source", "Status", "Amount"];
      rows = book.rows.map((r) => [
        r.jeNumber,
        r.date,
        r.description,
        r.reference ?? "",
        r.sourceModule,
        r.status,
        r.total,
      ]);
      rows.push(["", "", "TOTAL", "", "", "", book.grandTotal]);
      suffix = `${from}_${to}`;
      break;
    }

    case "tax-summary": {
      const tax = await getTaxSummary(entityId, from, to);
      headers = ["Month", "Output tax", "Input tax", "Net payable"];
      rows = tax.months.map((m) => [m.month, m.outputTax, m.inputTax, m.net]);
      rows.push(["TOTAL", tax.totalOutput, tax.totalInput, tax.totalNet]);
      suffix = `${from}_${to}`;
      break;
    }

    case "profit-loss": {
      const pl = await getProfitAndLoss(entityId, from, to);
      headers = ["Section", "Account number", "Account name", "Amount"];
      rows = [];
      for (const l of pl.revenue.lines) rows.push(["Revenue", l.number, l.name, l.amount]);
      rows.push(["Revenue", "", "Net revenue", pl.revenue.net]);
      for (const l of pl.cogs.lines) rows.push(["Cost of goods sold", l.number, l.name, l.amount]);
      rows.push(["", "", "Gross profit", pl.grossProfit]);
      for (const l of pl.operatingExpenses.lines) rows.push(["Operating expenses", l.number, l.name, l.amount]);
      rows.push(["", "", "Operating profit", pl.operatingProfit]);
      for (const l of pl.otherIncome.lines) rows.push(["Other income", l.number, l.name, l.amount]);
      for (const l of pl.otherExpense.lines) rows.push(["Other expenses", l.number, l.name, l.amount]);
      rows.push(["", "", "Profit before tax", pl.profitBeforeTax]);
      for (const l of pl.incomeTax.lines) rows.push(["Income tax", l.number, l.name, l.amount]);
      rows.push(["", "", "NET PROFIT", pl.netProfit]);
      suffix = `${from}_${to}`;
      break;
    }

    case "balance-sheet": {
      const bs = await getBalanceSheet(entityId, asOf);
      headers = ["Section", "Account number", "Account name", "Amount"];
      rows = [];
      for (const l of bs.currentAssets.lines) rows.push(["Current assets", l.number, l.name, l.amount]);
      rows.push(["", "", "Total current assets", bs.currentAssets.total]);
      for (const l of bs.nonCurrentAssets.lines) rows.push(["Non-current assets", l.number, l.name, l.amount]);
      rows.push(["", "", "Total non-current assets", bs.nonCurrentAssets.total]);
      rows.push(["", "", "TOTAL ASSETS", bs.totalAssets]);
      for (const l of bs.currentLiabilities.lines) rows.push(["Current liabilities", l.number, l.name, l.amount]);
      for (const l of bs.nonCurrentLiabilities.lines) rows.push(["Non-current liabilities", l.number, l.name, l.amount]);
      rows.push(["", "", "TOTAL LIABILITIES", bs.totalLiabilities]);
      for (const l of bs.equity.lines) rows.push(["Equity", l.number, l.name, l.amount]);
      if (bs.equity.priorEarnings) rows.push(["Equity", "", "Prior year earnings", bs.equity.priorEarnings]);
      rows.push(["Equity", "", "Current year profit", bs.equity.currentYearProfit]);
      rows.push(["", "", "TOTAL EQUITY", bs.equity.total]);
      rows.push(["", "", "TOTAL LIABILITIES + EQUITY", bs.totalLiabilitiesAndEquity]);
      break;
    }

    case "equity-changes": {
      const eq = await getChangesInEquity(entityId, from, to);
      headers = ["Account number", "Component", "Opening", "Movements", "Closing"];
      rows = eq.rows.map((r) => [r.number ?? "", r.name, r.opening, r.movements, r.closing]);
      rows.push(["", "TOTAL EQUITY", eq.totalOpening, eq.totalMovements, eq.totalClosing]);
      suffix = `${from}_${to}`;
      break;
    }

    case "ar-ageing":
    case "ap-ageing": {
      const ageing =
        report === "ar-ageing"
          ? await getArAgeing(entityId, asOf)
          : await getApAgeing(entityId, asOf);
      headers = [
        "Document",
        "Contact",
        "Issue date",
        "Due date",
        "Days overdue",
        "Bucket",
        "Currency",
        "Outstanding (document)",
        "Outstanding (base)",
      ];
      rows = ageing.rows.map((r) => [
        r.documentNumber,
        r.contactName,
        r.issueDate,
        r.dueDate,
        r.daysOverdue,
        BUCKET_LABELS[r.bucket],
        r.currency,
        r.outstandingDoc,
        r.outstanding,
      ]);
      rows.push(["", "TOTAL", "", "", "", "", "", "", ageing.total]);
      rows.push(["", "GL control account", "", "", "", "", "", "", ageing.controlBalance]);
      rows.push(["", "Difference", "", "", "", "", "", "", ageing.difference]);
      break;
    }

    case "inventory": {
      const items = await listItems(entityId);
      headers = ["SKU", "Name", "Costing method", "Unit", "Quantity on hand", "Value at cost", "Status"];
      rows = items.map((i) => [
        i.sku,
        i.name,
        i.costingMethod,
        i.unit,
        i.qtyOnHand,
        i.valueOnHand,
        i.isActive ? "active" : "inactive",
      ]);
      break;
    }

    default:
      return new Response("Unknown report", { status: 404 });
  }

  return csvResponse(exportFilename(report, suffix), toCsv(headers, rows));
}
