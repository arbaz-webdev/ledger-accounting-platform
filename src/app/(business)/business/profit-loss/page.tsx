import { guardPortal } from "@/lib/business-guard";
import { getProfitAndLoss, defaultFiscalRange, type PLLine } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function Line({ label, amount }: { label: string; amount: string }) {
  return (
    <tr>
      <td className="stmt-line-indent">{label}</td>
      <td className="td-num">{fmtMoney(amount)}</td>
    </tr>
  );
}
const acctLines = (lines: PLLine[]) =>
  lines.map((l) => <Line key={l.number} label={`${l.number} · ${l.name}`} amount={l.amount} />);

export default async function PortalProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { entityId, entityName } = await guardPortal("reports");
  const sp = await searchParams;
  const def = defaultFiscalRange(todayIso(), 1);
  const from = isDate(sp.from) ? sp.from! : def.from;
  const to = isDate(sp.to) ? sp.to! : def.to;

  const pl = await getProfitAndLoss(entityId, from, to);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="fade-up">
        <PageHeader title="Profit & Loss" sub="Live from your books.">
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
          <PrintButton />
        </PageHeader>

        <div className="card mx-auto max-w-2xl overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
            <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
              {entityName}
            </div>
            <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">
              Profit &amp; Loss Statement
            </div>
            <div className="text-xs text-[var(--ink-400)]">
              For the period {from} to {to}
            </div>
          </div>
          <table className="stmt pb-2">
            <tbody>
              <tr className="stmt-section">
                <td colSpan={2}>Revenue</td>
              </tr>
              {acctLines(pl.revenue.lines)}
              <tr className="stmt-subtotal">
                <td>Net revenue</td>
                <td className="td-num">{fmtMoney(pl.revenue.net)}</td>
              </tr>

              <tr className="stmt-section">
                <td colSpan={2}>Cost of goods sold</td>
              </tr>
              {acctLines(pl.cogs.lines)}
              <tr className="stmt-subtotal">
                <td>Gross profit</td>
                <td className="td-num">{fmtMoney(pl.grossProfit)}</td>
              </tr>

              <tr className="stmt-section">
                <td colSpan={2}>Operating expenses</td>
              </tr>
              {acctLines(pl.operatingExpenses.lines)}

              <tr className="stmt-total">
                <td>Net profit / (loss)</td>
                <td className="td-num">{fmtMoney(pl.netProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
