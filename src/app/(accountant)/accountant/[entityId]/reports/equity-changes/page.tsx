import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getChangesInEquity, defaultFiscalRange } from "@/services/statements";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function EquityChangesPage({
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

  const eqc = await getChangesInEquity(entityId, from, to);

  return (
    <div className="fade-up">
      <PageHeader
        title="Statement of Changes in Equity"
        sub="Opening balances, movements and closing balances per equity component — totals tie to the balance sheet."
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
        <ExportButton entityId={entityId} report="equity-changes" params={{ from, to }} />
        <PrintButton />
      </PageHeader>

      <div className="card mx-auto max-w-3xl overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-6 py-5 text-center">
          <div className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink-900)]">
            {entity?.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">
            Statement of Changes in Equity
          </div>
          <div className="text-xs text-[var(--ink-400)]">
            For the period {from} to {to}
          </div>
        </div>
        <table className="stmt pb-2">
          <thead>
            <tr>
              <th></th>
              <th className="td-num text-xs uppercase tracking-wide">Opening</th>
              <th className="td-num text-xs uppercase tracking-wide">Movements</th>
              <th className="td-num text-xs uppercase tracking-wide">Closing</th>
            </tr>
          </thead>
          <tbody>
            {eqc.rows.map((r) => (
              <tr key={r.number ?? "pl"}>
                <td className="stmt-line-indent">
                  {r.number ? `${r.number} · ${r.name}` : r.name}
                </td>
                <td className="td-num">{fmtMoney(r.opening)}</td>
                <td className="td-num">{fmtMoney(r.movements)}</td>
                <td className="td-num">{fmtMoney(r.closing)}</td>
              </tr>
            ))}
            <tr className="stmt-total">
              <td>Total equity</td>
              <td className="td-num">{fmtMoney(eqc.totalOpening)}</td>
              <td className="td-num">{fmtMoney(eqc.totalMovements)}</td>
              <td className="td-num">{fmtMoney(eqc.totalClosing)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
