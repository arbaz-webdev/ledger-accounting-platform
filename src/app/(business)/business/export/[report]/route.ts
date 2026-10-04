import { guardPortal } from "@/lib/business-guard";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/csv-export";
import { getProfitAndLoss, getBalanceSheet, getCashFlow, defaultFiscalRange } from "@/services/statements";
import { getArAgeing, getApAgeing, BUCKET_LABELS } from "@/services/ageing";
import { todayIso } from "@/lib/format";

const isDate = (value: string | null) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function GET(request: Request, context: { params: Promise<{ report: string }> }) {
  const { report } = await context.params;
  if (!["profit-loss", "balance-sheet", "cash-flow", "ar-ageing", "ap-ageing"].includes(report)) {
    return new Response("Unknown report", { status: 404 });
  }
  // Route handlers do not inherit page/layout guards. Recheck entity and grants.
  const portal = await guardPortal("reports");
  if (report === "ar-ageing" && !portal.allowed.has("sales")) return new Response("Forbidden", { status: 403 });
  if (report === "ap-ageing" && !portal.allowed.has("purchases")) return new Response("Forbidden", { status: 403 });
  const today = todayIso();
  const params = new URL(request.url).searchParams;
  const defaults = defaultFiscalRange(today, portal.fiscalYearStartMonth);
  const from = isDate(params.get("from")) ? params.get("from")! : defaults.from;
  const to = isDate(params.get("to")) ? params.get("to")! : today;
  const asOf = isDate(params.get("asOf")) ? params.get("asOf")! : today;
  if (from > to) return new Response("Invalid date range", { status: 400 });
  let headers: string[] = [];
  let rows: CsvValue[][] = [];
  let suffix = asOf;

  switch (report) {
    case "profit-loss": {
      const pl = await getProfitAndLoss(portal.entityId, from, to);
      headers = ["Section", "Account number", "Account name", "Amount"];
      rows = [];
      for (const [label, lines] of [["Revenue", pl.revenue.lines], ["Cost of goods sold", pl.cogs.lines], ["Operating expenses", pl.operatingExpenses.lines], ["Other income", pl.otherIncome.lines], ["Other expense", pl.otherExpense.lines], ["Income tax", pl.incomeTax.lines]] as const) {
        for (const line of lines) rows.push([label, line.number, line.name, line.amount]);
      }
      rows.push(["", "", "Net profit / (loss)", pl.netProfit]);
      suffix = `${from}_${to}`;
      break;
    }
    case "balance-sheet": {
      const bs = await getBalanceSheet(portal.entityId, asOf);
      headers = ["Section", "Account number", "Account name", "Amount"];
      rows = [];
      for (const [label, lines] of [["Current assets", bs.currentAssets.lines], ["Non-current assets", bs.nonCurrentAssets.lines], ["Current liabilities", bs.currentLiabilities.lines], ["Non-current liabilities", bs.nonCurrentLiabilities.lines], ["Equity", bs.equity.lines]] as const) {
        for (const line of lines) rows.push([label, line.number, line.name, line.amount]);
      }
      rows.push(["", "", "Total assets", bs.totalAssets], ["", "", "Total liabilities and equity", bs.totalLiabilitiesAndEquity]);
      break;
    }
    case "cash-flow": {
      const cf = await getCashFlow(portal.entityId, from, to);
      headers = ["Section", "Line", "Amount"];
      rows = [["Operating", "Net profit / (loss)", cf.operating.netProfit]];
      for (const [label, lines, total] of [["Operating", cf.operating.lines, cf.operating.total], ["Investing", cf.investing.lines, cf.investing.total], ["Financing", cf.financing.lines, cf.financing.total]] as const) {
        for (const line of lines) rows.push([label, line.label, line.amount]);
        rows.push([label, "Net cash", total]);
      }
      rows.push(["", "Opening cash", cf.openingCash], ["", "Closing cash", cf.closingCash]);
      suffix = `${from}_${to}`;
      break;
    }
    case "ar-ageing":
    case "ap-ageing": {
      const ageing = report === "ar-ageing" ? await getArAgeing(portal.entityId, asOf) : await getApAgeing(portal.entityId, asOf);
      headers = ["Document", "Contact", "Issue date", "Due date", "Bucket", "Currency", "Outstanding (document)", "Outstanding (base)"];
      rows = ageing.rows.map(row => [row.documentNumber, row.contactName, row.issueDate, row.dueDate, BUCKET_LABELS[row.bucket], row.currency, row.outstandingDoc, row.outstanding]);
      rows.push(["TOTAL", "", "", "", "", "", "", ageing.total]);
      break;
    }
  }
  return csvResponse(exportFilename(report, suffix), toCsv(headers, rows));
}
