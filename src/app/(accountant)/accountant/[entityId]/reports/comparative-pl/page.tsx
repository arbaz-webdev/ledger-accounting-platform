import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getComparativePL, defaultFiscalRange } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function variance(current: string, prior: string): string {
  return (Number(current) - Number(prior)).toFixed(2);
}

function Row({
  label,
  current,
  prior,
  strong,
  section,
}: {
  label: string;
  current?: string;
  prior?: string;
  strong?: boolean;
  section?: boolean;
}) {
  if (section) {
    return (
      <tr className="stmt-section">
        <td colSpan={4}>{label}</td>
      </tr>
    );
  }
  const cls = strong ? "stmt-subtotal" : "";
  return (
    <tr className={cls}>
      <td className={strong ? "" : "stmt-line-indent"}>{label}</td>
      <td className="td-num">{fmtMoney(current!)}</td>
      <td className="td-num">{fmtMoney(prior!)}</td>
      <td className="td-num">{fmtMoney(variance(current!, prior!))}</td>
    </tr>
  );
}

export default async function ComparativePLPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;

  const [entity] = await db
    .select({ fy: entities.fiscalYearStartMonth, name: entities.name })
    .from(entities)
    .where(eq(entities.id, entityId));
  const def = defaultFiscalRange(todayIso(), entity?.fy ?? 1);
  const from = isDate(sp.from) ? sp.from! : def.from;
  const to = isDate(sp.to) ? sp.to! : def.to;

  const { current, prior } = await getComparativePL(entityId, from, to);

  return (
    <div className="fade-up">
      <PageHeader
        title="Comparative Profit & Loss"
        sub="Current period against the same period one year earlier."
      >
        <form className="flex items-end gap-2">
          <div>
            <label className="field-label">From</label>
            <input type="date" name="from" defaultValue={from} className="input w-40" />
          </div>
          <div>
            <label className="field-label">To</label>
            <input type="date" name="to" defaultValue={to} className="input w-40" />
          </div>
          <button className="btn btn-secondary">Run</button>
        </form>
        <ExportButton entityId={entityId} report="profit-loss" params={{ from, to }} />
        <PrintButton />
      </PageHeader>

      <div className="card mx-auto max-w-3xl overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
          <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
            {entity?.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">
            Comparative Profit &amp; Loss
          </div>
          <div className="text-xs text-[var(--ink-400)]">
            {current.from} to {current.to} vs {prior.from} to {prior.to}
          </div>
        </div>
        <table className="stmt pb-2">
          <thead>
            <tr>
              <th></th>
              <th className="td-num text-xs uppercase tracking-wide">Current</th>
              <th className="td-num text-xs uppercase tracking-wide">Prior year</th>
              <th className="td-num text-xs uppercase tracking-wide">Variance</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Revenue" section />
            <Row label="Net revenue" current={current.revenue.net} prior={prior.revenue.net} />
            <Row label="Cost of goods sold" current={current.cogs.net} prior={prior.cogs.net} />
            <Row label="Gross profit" current={current.grossProfit} prior={prior.grossProfit} strong />

            <Row label="Operating" section />
            <Row
              label="Operating expenses"
              current={current.operatingExpenses.total}
              prior={prior.operatingExpenses.total}
            />
            <Row
              label="Operating profit (EBIT)"
              current={current.operatingProfit}
              prior={prior.operatingProfit}
              strong
            />

            <Row label="Other" section />
            <Row
              label="Other income"
              current={current.otherIncome.total}
              prior={prior.otherIncome.total}
            />
            <Row
              label="Other expenses"
              current={current.otherExpense.total}
              prior={prior.otherExpense.total}
            />
            <Row
              label="Profit before tax"
              current={current.profitBeforeTax}
              prior={prior.profitBeforeTax}
              strong
            />
            <Row label="Income tax" current={current.incomeTax.total} prior={prior.incomeTax.total} />

            <tr className="stmt-total">
              <td>Net profit / (loss)</td>
              <td className="td-num">{fmtMoney(current.netProfit)}</td>
              <td className="td-num">{fmtMoney(prior.netProfit)}</td>
              <td className="td-num">{fmtMoney(variance(current.netProfit, prior.netProfit))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
