import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getProfitAndLoss, defaultFiscalRange, type PLLine } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function Line({ label, amount, muted }: { label: string; amount: string; muted?: boolean }) {
  return (
    <tr className={muted ? "stmt-muted" : ""}>
      <td className="stmt-line-indent">{label}</td>
      <td className="td-num">{fmtMoney(amount)}</td>
    </tr>
  );
}
function Section({ label }: { label: string }) {
  return (
    <tr className="stmt-section">
      <td colSpan={2}>{label}</td>
    </tr>
  );
}
function Subtotal({ label, amount }: { label: string; amount: string }) {
  return (
    <tr className="stmt-subtotal">
      <td>{label}</td>
      <td className="td-num">{fmtMoney(amount)}</td>
    </tr>
  );
}
const acctLines = (lines: PLLine[]) =>
  lines.map((l) => <Line key={l.number} label={`${l.number} · ${l.name}`} amount={l.amount} />);

export default async function ProfitLossPage({
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

  const pl = await getProfitAndLoss(entityId, from, to);

  return (
    <div className="fade-up">
      <PageHeader title="Profit & Loss" sub="Income statement — live from the ledger.">
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

      <div className="card mx-auto max-w-2xl overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
          <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
            {entity?.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">Profit &amp; Loss Statement</div>
          <div className="text-xs text-[var(--ink-400)]">
            For the period {from} to {to}
          </div>
        </div>
        <table className="stmt pb-2">
          <tbody>
            <Section label="Revenue" />
            {acctLines(pl.revenue.lines)}
            {pl.revenue.discounts !== "0.00" && (
              <Line label="Less: sales returns & discounts" amount={`-${pl.revenue.discounts}`} muted />
            )}
            <Subtotal label="Net revenue" amount={pl.revenue.net} />

            <Section label="Cost of goods sold" />
            {acctLines(pl.cogs.lines)}
            {pl.cogs.discounts !== "0.00" && (
              <Line label="Less: purchase discounts" amount={`-${pl.cogs.discounts}`} muted />
            )}
            <Subtotal label="Gross profit" amount={pl.grossProfit} />

            <Section label="Operating expenses" />
            {acctLines(pl.operatingExpenses.lines)}
            <Subtotal label="Operating profit (EBIT)" amount={pl.operatingProfit} />

            {(pl.otherIncome.lines.length > 0 || pl.otherExpense.lines.length > 0) && (
              <>
                <Section label="Other income / expenses" />
                {acctLines(pl.otherIncome.lines)}
                {acctLines(pl.otherExpense.lines)}
                <Subtotal label="Profit before tax" amount={pl.profitBeforeTax} />
              </>
            )}

            {pl.incomeTax.lines.length > 0 && (
              <>
                <Section label="Income tax" />
                {acctLines(pl.incomeTax.lines)}
              </>
            )}

            <tr className="stmt-total">
              <td>Net profit / (loss)</td>
              <td className="td-num">{fmtMoney(pl.netProfit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
