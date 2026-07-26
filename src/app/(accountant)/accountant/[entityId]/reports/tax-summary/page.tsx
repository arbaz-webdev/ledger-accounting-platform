import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getTaxSummary } from "@/services/reports";
import { defaultFiscalRange } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function TaxSummaryPage({
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

  const tax = await getTaxSummary(entityId, from, to);
  const owed = Number(tax.totalNet) >= 0;

  return (
    <div className="fade-up">
      <PageHeader
        title="Tax summary"
        sub={`Output tax (${tax.outputAccount}) vs recoverable input tax (${tax.inputAccount}).`}
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
        <ExportButton entityId={entityId} report="tax-summary" params={{ from, to }} />
        <PrintButton />
      </PageHeader>

      <div className={`banner mb-4 ${owed ? "banner-warn" : "banner-ok"}`}>
        <span>
          {owed
            ? `Net ${fmtMoney(tax.totalNet)} payable to the tax authority for this range.`
            : `Net ${fmtMoney(Math.abs(Number(tax.totalNet)))} recoverable from the tax authority for this range.`}
        </span>
      </div>

      <div className="card mx-auto max-w-2xl overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
          <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
            {entity?.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">Sales Tax Summary</div>
          <div className="text-xs text-[var(--ink-400)]">
            For the period {from} to {to}
          </div>
        </div>
        {tax.months.length === 0 ? (
          <p className="px-6 py-10 text-center text-[0.8125rem] text-[var(--ink-400)]">
            No tax activity in this range.
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Output tax</th>
                <th className="text-right">Input tax</th>
                <th className="text-right">Net payable</th>
              </tr>
            </thead>
            <tbody>
              {tax.months.map((m) => (
                <tr key={m.month}>
                  <td className="acct">{m.month}</td>
                  <td className="td-num">{fmtMoney(m.outputTax)}</td>
                  <td className="td-num">{fmtMoney(m.inputTax)}</td>
                  <td className="td-num font-medium">{fmtMoney(m.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="td-num">{fmtMoney(tax.totalOutput)}</td>
                <td className="td-num">{fmtMoney(tax.totalInput)}</td>
                <td className="td-num">{fmtMoney(tax.totalNet)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
