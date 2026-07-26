import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getBalanceSheet, type BSLine } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
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
function Total({ label, amount }: { label: string; amount: string }) {
  return (
    <tr className="stmt-total">
      <td>{label}</td>
      <td className="td-num">{fmtMoney(amount)}</td>
    </tr>
  );
}
const acctLines = (lines: BSLine[]) =>
  lines.map((l) => <Line key={l.number} label={`${l.number} · ${l.name}`} amount={l.amount} />);

export default async function BalanceSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const asOf = isDate(sp.asOf) ? sp.asOf! : todayIso();

  const [entity] = await db
    .select({ name: entities.name })
    .from(entities)
    .where(eq(entities.id, entityId));
  const bs = await getBalanceSheet(entityId, asOf);

  return (
    <div className="fade-up">
      <PageHeader title="Balance Sheet" sub="Statement of financial position.">
        <form className="flex items-end gap-2">
          <div>
            <label className="field-label">As at</label>
            <input type="date" name="asOf" defaultValue={asOf} className="input w-40" />
          </div>
          <button className="btn btn-secondary">Run</button>
        </form>
        <ExportButton entityId={entityId} report="balance-sheet" params={{ asOf }} />
        <PrintButton />
      </PageHeader>

      {bs.balanced ? (
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Balanced — Assets = Liabilities + Equity ({fmtMoney(bs.totalAssets)}).
          </span>
        </div>
      ) : (
        <div className="banner banner-error mb-4">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-medium">
            OUT OF BALANCE by {fmtMoney(bs.difference)} — this indicates a ledger bug.
          </span>
        </div>
      )}

      <div className="card mx-auto max-w-2xl overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
          <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
            {entity?.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">Balance Sheet</div>
          <div className="text-xs text-[var(--ink-400)]">As at {asOf}</div>
        </div>
        <table className="stmt pb-2">
          <tbody>
            <Section label="Current assets" />
            {acctLines(bs.currentAssets.lines)}
            <Subtotal label="Total current assets" amount={bs.currentAssets.total} />
            <Section label="Non-current assets" />
            {acctLines(bs.nonCurrentAssets.lines)}
            <Subtotal label="Total non-current assets" amount={bs.nonCurrentAssets.total} />
            <Total label="Total assets" amount={bs.totalAssets} />

            <Section label="Current liabilities" />
            {acctLines(bs.currentLiabilities.lines)}
            <Subtotal label="Total current liabilities" amount={bs.currentLiabilities.total} />
            <Section label="Non-current liabilities" />
            {acctLines(bs.nonCurrentLiabilities.lines)}
            <Subtotal label="Total non-current liabilities" amount={bs.nonCurrentLiabilities.total} />
            <Subtotal label="Total liabilities" amount={bs.totalLiabilities} />

            <Section label="Equity" />
            {acctLines(bs.equity.lines)}
            {bs.equity.priorEarnings && (
              <Line label="Retained earnings b/f (prior periods)" amount={bs.equity.priorEarnings} />
            )}
            <Line label="Current year profit / (loss)" amount={bs.equity.currentYearProfit} />
            <Subtotal label="Total equity" amount={bs.equity.total} />
            <Total label="Total liabilities + equity" amount={bs.totalLiabilitiesAndEquity} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
