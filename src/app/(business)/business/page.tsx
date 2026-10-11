import { portalContext } from "@/lib/business-guard";
import { getProfitAndLoss, getCashFlow, defaultFiscalRange } from "@/services/statements";
import { getArAgeing, getApAgeing } from "@/services/ageing";
import { MODULE_LABEL, type ModuleKey } from "@/services/permissions";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { IconShield } from "@/components/icons";
import { listItems, getFastMovingItems } from "@/services/inventory";
import Decimal from "decimal.js";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function BusinessDashboard({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { entityName, entityId, baseCurrency, fiscalYearStartMonth, allowed } = await portalContext();
  const { denied } = await searchParams;

  const canReports = allowed.has("reports");
  const today = todayIso();

  let pl = null;
  let arTotal = "0.00";
  let apTotal = "0.00";
  let closingCash = "0.00";
  let monthly: { label: string; revenue: number; costs: number }[] = [];
  let stockValue = "0.00";
  let lowStock: { sku: string; name: string; qtyOnHand: string; reorderLevel: string }[] = [];
  let fastMoving: { sku: string; name: string; quantity: string }[] = [];
  if (canReports) {
    const range = defaultFiscalRange(today, fiscalYearStartMonth);
    const monthStarts = Array.from({ length: 6 }, (_, i) => {
      const month = new Date(`${today}T00:00:00Z`);
      month.setUTCDate(1);
      month.setUTCMonth(month.getUTCMonth() - 5 + i);
      return month;
    });
    const [plResult, ar, ap, cash, ...monthlyPl] = await Promise.all([
      getProfitAndLoss(entityId, range.from, range.to),
      allowed.has("sales") ? getArAgeing(entityId, today) : null,
      allowed.has("purchases") ? getApAgeing(entityId, today) : null,
      getCashFlow(entityId, range.from, range.to),
      ...monthStarts.map((start) => {
        const from = start.toISOString().slice(0, 10);
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        return getProfitAndLoss(entityId, from, end < today ? end : today);
      }),
    ]);
    pl = plResult;
    arTotal = ar?.total ?? "0.00";
    apTotal = ap?.total ?? "0.00";
    closingCash = cash.closingCash;
    monthly = monthStarts.map((start, index) => ({
      label: start.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      revenue: Number(monthlyPl[index].revenue.net),
      costs: Number(monthlyPl[index].cogs.net) + Number(monthlyPl[index].operatingExpenses.total),
    }));
    if (allowed.has("inventory")) {
      const [items, movers] = await Promise.all([listItems(entityId, { activeOnly: true }), getFastMovingItems(entityId)]);
      const products = items.filter((item) => !item.isService);
      stockValue = products.reduce((value, item) => value.plus(item.valueOnHand), new Decimal(0)).toFixed(2);
      lowStock = products.filter((item) => Number(item.reorderLevel) > 0 && Number(item.qtyOnHand) <= Number(item.reorderLevel));
      fastMoving = movers;
    }
  }
  const chartMax = Math.max(1, ...monthly.flatMap((point) => [point.revenue, point.costs]));
  const expenseLines = [...(pl?.operatingExpenses.lines ?? [])].sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))).slice(0, 5);
  const expenseMax = Math.max(1, ...expenseLines.map((line) => Math.abs(Number(line.amount))));
  const expenseColors = ["#0d9488", "#2563eb", "#f59e0b", "#e11d48", "#8b5cf6"];
  const expenseTotal = expenseLines.reduce((total, line) => total + Math.abs(Number(line.amount)), 0);
  let expenseOffset = 0;
  const expenseGradient = expenseTotal > 0 ? `conic-gradient(${expenseLines.map((line, index) => {
    const start = expenseOffset;
    expenseOffset += Math.abs(Number(line.amount)) / expenseTotal * 100;
    return `${expenseColors[index]} ${start}% ${expenseOffset}%`;
  }).join(", ")})` : undefined;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AutoRefresh />
      <div className="fade-up">
        <PageHeader
          title={entityName}
          sub="Your current financial picture, updated from the books."
        />

        {denied && (
          <div className="banner banner-warn mb-4">
            <span>
              You don&apos;t have access to{" "}
              {MODULE_LABEL[denied as ModuleKey] ?? denied}. Ask your accountant if you need it.
            </span>
          </div>
        )}

        {!canReports ? (
          <div className="card">
            <EmptyState
              icon={<IconShield className="h-5 w-5" />}
              title="Nothing shared with you yet"
              hint="Your accountant hasn't enabled any areas for your account. They can grant access under Users & permissions."
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard
                label="Revenue (year to date)"
                value={fmtMoney(pl!.revenue.net)}
                hint={baseCurrency}
              />
              <StatCard
                label="Net profit (year to date)"
                value={fmtMoney(pl!.netProfit)}
                accent={Number(pl!.netProfit) < 0 ? "negative" : "brand"}
                hint={baseCurrency}
              />
              <StatCard label="Cash & bank" value={fmtMoney(closingCash)} hint={baseCurrency} />
              {allowed.has("inventory") && <StatCard label="Inventory value" value={fmtMoney(stockValue)} hint={`${lowStock.length} reorder alerts`} />}
              {allowed.has("sales") && (
                <StatCard label="Owed to you" value={fmtMoney(arTotal)} hint="Open invoices" />
              )}
              {allowed.has("purchases") && (
                <StatCard label="You owe" value={fmtMoney(apTotal)} hint="Open bills" />
              )}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <section className="card p-5" aria-labelledby="revenue-cost-title">
                <h2 id="revenue-cost-title" className="text-base font-semibold text-[var(--ink-900)]">Revenue & costs</h2>
                <p className="mb-4 text-sm text-[var(--ink-500)]">Last six calendar months · {baseCurrency}</p>
                <div className="mb-3 flex gap-4 text-xs text-[var(--ink-700)]"><span><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded-sm bg-[var(--brand-500)]" />Revenue</span><span><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded-sm bg-[var(--ink-400)]" />COGS & operating expenses</span></div>
                <div className="flex h-52 items-end gap-3 border-b border-[var(--ink-100)] pb-2">
                  {monthly.map((point, index) => <div key={index} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" aria-label={`${point.label}: revenue ${fmtMoney(point.revenue)}, costs ${fmtMoney(point.costs)}`}>
                    <div className="flex h-full w-full items-end justify-center gap-1" aria-hidden="true">
                      <div className="w-1/3 rounded-t bg-[var(--brand-500)]" style={{ height: `${Math.max(2, Math.min(100, point.revenue / chartMax * 100))}%` }} />
                      <div className="w-1/3 rounded-t bg-[var(--ink-400)]" style={{ height: `${Math.max(2, Math.min(100, point.costs / chartMax * 100))}%` }} />
                    </div>
                    <span className="text-xs text-[var(--ink-600)]">{point.label}</span>
                  </div>)}
                </div>
                <table className="sr-only"><caption>Monthly revenue and costs</caption><thead><tr><th>Month</th><th>Revenue</th><th>Costs</th></tr></thead><tbody>{monthly.map((point, index) => <tr key={index}><td>{point.label}</td><td>{fmtMoney(point.revenue)}</td><td>{fmtMoney(point.costs)}</td></tr>)}</tbody></table>
              </section>
              <section className="card p-5" aria-labelledby="expense-title">
                <h2 id="expense-title" className="text-base font-semibold text-[var(--ink-900)]">Operating expenses</h2>
                <p className="mb-4 text-sm text-[var(--ink-500)]">Fiscal year to date · {baseCurrency}</p>
                {expenseLines.length ? <div className="flex flex-wrap items-center gap-6"><div role="img" aria-label="Operating expense share by category" className="h-40 w-40 shrink-0 rounded-full" style={{ background: expenseGradient }} /><ul className="min-w-0 flex-1 space-y-4">{expenseLines.map((line, index) => <li key={line.number}>
                  <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate">{line.name}</span><span className="num shrink-0">{fmtMoney(line.amount)}</span></div>
                  <div className="h-2 rounded-full bg-[var(--ink-100)]"><div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.abs(Number(line.amount)) / expenseMax * 100)}%`, backgroundColor: expenseColors[index] }} /></div>
                </li>)}</ul></div> : <p className="text-sm text-[var(--ink-500)]">No operating expenses in this period.</p>}
              </section>
            </div>

            {allowed.has("inventory") && <section className="card mt-5 p-5" aria-labelledby="inventory-title">
              <h2 id="inventory-title" className="text-base font-semibold text-[var(--ink-900)]">Inventory status</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div><h3 className="text-sm font-semibold">Reorder alerts</h3>{lowStock.length ? <ul className="mt-2 space-y-1 text-sm">{lowStock.slice(0, 5).map((item) => <li key={item.sku}>{item.name}: {item.qtyOnHand} on hand (threshold {item.reorderLevel})</li>)}</ul> : <p className="mt-2 text-sm text-[var(--ink-500)]">No items below their reorder level.</p>}</div>
                <div><h3 className="text-sm font-semibold">Fast-moving products · last 30 days</h3>{fastMoving.length ? <ul className="mt-2 space-y-1 text-sm">{fastMoving.map((item) => <li key={item.sku}>{item.name}: {item.quantity} issued</li>)}</ul> : <p className="mt-2 text-sm text-[var(--ink-500)]">No recent stock issues.</p>}</div>
              </div>
            </section>}

            <div className="card mt-5 p-5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Where to look</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--ink-500)]">
                Use the menus above for transactions and reports. This page refreshes automatically while open.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
