import { guardPortal } from "@/lib/business-guard";
import { getCashFlow, defaultFiscalRange } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const isDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

export default async function BusinessCashFlowPage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { entityId, entityName, fiscalYearStartMonth } = await guardPortal("reports");
  const sp = await searchParams;
  const defaults = defaultFiscalRange(todayIso(), fiscalYearStartMonth);
  const from = isDate(sp.from) ? sp.from! : defaults.from;
  const to = isDate(sp.to) ? sp.to! : defaults.to;
  const cash = await getCashFlow(entityId, from, to);
  const sections = [
    { label: "Operating activities", lines: [{ label: "Net profit / (loss)", amount: cash.operating.netProfit }, ...cash.operating.lines], total: cash.operating.total },
    { label: "Investing activities", lines: cash.investing.lines, total: cash.investing.total },
    { label: "Financing activities", lines: cash.financing.lines, total: cash.financing.total },
  ];

  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Cash Flow" sub={`Live statement for ${entityName}`}>
      <form className="flex flex-wrap items-end gap-2">
        <label className="field-label">From<input type="date" name="from" defaultValue={from} className="input mt-1 w-40" /></label>
        <label className="field-label">To<input type="date" name="to" defaultValue={to} className="input mt-1 w-40" /></label>
        <button className="btn btn-secondary">Run</button>
      </form>
      <PrintButton />
      <a className="btn btn-secondary" href={`/business/export/cash-flow?from=${from}&to=${to}`}>Export CSV</a>
    </PageHeader>
    {!cash.reconciles && <p role="alert" className="banner banner-error mb-4">Cash movement does not reconcile. Ask your accountant to investigate.</p>}
    <div className="card mx-auto max-w-2xl overflow-x-auto">
      <table className="stmt"><caption className="px-6 py-5 text-left font-semibold">{entityName} · {from} to {to}</caption><tbody>
        {sections.map(section => <FragmentSection key={section.label} {...section} />)}
        <tr className="stmt-total"><td>Net change in cash</td><td className="td-num">{fmtMoney(cash.netChange)}</td></tr>
        <tr><td>Opening cash</td><td className="td-num">{fmtMoney(cash.openingCash)}</td></tr>
        <tr className="stmt-subtotal"><td>Closing cash</td><td className="td-num">{fmtMoney(cash.closingCash)}</td></tr>
      </tbody></table>
    </div>
  </main>;
}

function FragmentSection({ label, lines, total }: { label: string; lines: { label: string; amount: string }[]; total: string }) {
  return <>
    <tr className="stmt-section"><th colSpan={2} scope="colgroup">{label}</th></tr>
    {lines.length ? lines.map((line, i) => <tr key={`${line.label}-${i}`}><td className="stmt-line-indent">{line.label}</td><td className="td-num">{fmtMoney(line.amount)}</td></tr>) : <tr className="stmt-muted"><td>No activity</td><td className="td-num">0.00</td></tr>}
    <tr className="stmt-subtotal"><td>Net cash from {label.toLowerCase()}</td><td className="td-num">{fmtMoney(total)}</td></tr>
  </>;
}
