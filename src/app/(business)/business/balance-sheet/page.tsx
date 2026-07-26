import { guardPortal } from "@/lib/business-guard";
import { getBalanceSheet, type BSLine } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function Section({ label }: { label: string }) {
  return (
    <tr className="stmt-section">
      <td colSpan={2}>{label}</td>
    </tr>
  );
}
const lines = (rows: BSLine[]) =>
  rows.map((l) => (
    <tr key={l.number}>
      <td className="stmt-line-indent">{`${l.number} · ${l.name}`}</td>
      <td className="td-num">{fmtMoney(l.amount)}</td>
    </tr>
  ));

export default async function PortalBalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { entityId, entityName } = await guardPortal("reports");
  const sp = await searchParams;
  const asOf = isDate(sp.asOf) ? sp.asOf! : todayIso();

  const bs = await getBalanceSheet(entityId, asOf);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="fade-up">
        <PageHeader title="Balance Sheet" sub="Statement of financial position.">
          <form className="flex items-end gap-2">
            <div>
              <label className="field-label">As at</label>
              <input type="date" name="asOf" defaultValue={asOf} className="input w-40" />
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
            <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">Balance Sheet</div>
            <div className="text-xs text-[var(--ink-400)]">As at {asOf}</div>
          </div>
          <table className="stmt pb-2">
            <tbody>
              <Section label="Current assets" />
              {lines(bs.currentAssets.lines)}
              <tr className="stmt-subtotal">
                <td>Total current assets</td>
                <td className="td-num">{fmtMoney(bs.currentAssets.total)}</td>
              </tr>

              <Section label="Non-current assets" />
              {lines(bs.nonCurrentAssets.lines)}
              <tr className="stmt-subtotal">
                <td>Total assets</td>
                <td className="td-num">{fmtMoney(bs.totalAssets)}</td>
              </tr>

              <Section label="Liabilities" />
              {lines(bs.currentLiabilities.lines)}
              {lines(bs.nonCurrentLiabilities.lines)}
              <tr className="stmt-subtotal">
                <td>Total liabilities</td>
                <td className="td-num">{fmtMoney(bs.totalLiabilities)}</td>
              </tr>

              <Section label="Equity" />
              {lines(bs.equity.lines)}
              {bs.equity.priorEarnings && (
                <tr>
                  <td className="stmt-line-indent">Prior year earnings</td>
                  <td className="td-num">{fmtMoney(bs.equity.priorEarnings)}</td>
                </tr>
              )}
              <tr>
                <td className="stmt-line-indent">Current year profit / (loss)</td>
                <td className="td-num">{fmtMoney(bs.equity.currentYearProfit)}</td>
              </tr>
              <tr className="stmt-subtotal">
                <td>Total equity</td>
                <td className="td-num">{fmtMoney(bs.equity.total)}</td>
              </tr>

              <tr className="stmt-total">
                <td>Total liabilities + equity</td>
                <td className="td-num">{fmtMoney(bs.totalLiabilitiesAndEquity)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
