import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getCashFlow, defaultFiscalRange, type CFLine } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { IconCheck, IconAlert } from "@/components/icons";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function Line({ label, amount }: { label: string; amount: string }) {
  return (
    <tr>
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
const cfLines = (lines: CFLine[]) =>
  lines.map((l, i) => <Line key={i} label={l.label} amount={l.amount} />);

export default async function CashFlowPage({
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

  const cf = await getCashFlow(entityId, from, to);

  return (
    <div className="fade-up">
      <PageHeader title="Cash Flow Statement" sub="Indirect method — live from the ledger.">
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
      </PageHeader>

      {cf.reconciles ? (
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Reconciled — net change equals closing cash − opening cash.</span>
        </div>
      ) : (
        <div className="banner banner-error mb-4">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-medium">
            Does not reconcile to the cash movement — this indicates a ledger bug.
          </span>
        </div>
      )}

      <div className="card mx-auto max-w-2xl overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
          <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
            {entity?.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">Cash Flow Statement</div>
          <div className="text-xs text-[var(--ink-400)]">
            For the period {from} to {to}
          </div>
        </div>
        <table className="stmt pb-2">
          <tbody>
            <Section label="Operating activities" />
            <Line label="Net profit / (loss) for the period" amount={cf.operating.netProfit} />
            {cfLines(cf.operating.lines)}
            <Subtotal label="Net cash from operating activities" amount={cf.operating.total} />

            <Section label="Investing activities" />
            {cf.investing.lines.length > 0 ? (
              cfLines(cf.investing.lines)
            ) : (
              <tr className="stmt-muted">
                <td className="stmt-line-indent">No investing activity</td>
                <td className="td-num">0.00</td>
              </tr>
            )}
            <Subtotal label="Net cash from investing activities" amount={cf.investing.total} />

            <Section label="Financing activities" />
            {cf.financing.lines.length > 0 ? (
              cfLines(cf.financing.lines)
            ) : (
              <tr className="stmt-muted">
                <td className="stmt-line-indent">No financing activity</td>
                <td className="td-num">0.00</td>
              </tr>
            )}
            <Subtotal label="Net cash from financing activities" amount={cf.financing.total} />

            <tr className="stmt-total">
              <td>Net change in cash</td>
              <td className="td-num">{fmtMoney(cf.netChange)}</td>
            </tr>
            <Line label="Opening cash balance" amount={cf.openingCash} />
            <Subtotal label="Closing cash balance" amount={cf.closingCash} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
