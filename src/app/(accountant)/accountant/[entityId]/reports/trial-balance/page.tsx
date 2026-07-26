import { getTrialBalance } from "@/services/reports";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";
import { IconCheck, IconAlert } from "@/components/icons";

export default async function TrialBalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { entityId } = await params;
  const { asOf: asOfParam } = await searchParams;
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : todayIso();

  const tb = await getTrialBalance(entityId, asOf);

  return (
    <div className="fade-up">
      <PageHeader title="Trial Balance" sub="Self-balancing check across all posted activity.">
        <form className="flex items-end gap-2">
          <div>
            <label className="field-label">As at</label>
            <input type="date" name="asOf" defaultValue={asOf} className="input w-40" />
          </div>
          <button className="btn btn-secondary">Run</button>
        </form>
        <ExportButton entityId={entityId} report="trial-balance" params={{ asOf }} />
        <PrintButton />
      </PageHeader>

      {tb.balanced ? (
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            In balance — total debits equal total credits ({fmtMoney(tb.totalDebits)}).
          </span>
        </div>
      ) : (
        <div className="banner banner-error mb-4">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-medium">
            OUT OF BALANCE — this should be impossible and indicates a ledger engine bug.
          </span>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th className="w-40 text-right">Debit</th>
              <th className="w-40 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId} className="tbl-row-link">
                <td>
                  <span className="acct mr-2">{r.accountNumber}</span>
                  <span className="font-medium text-[var(--ink-800)]">{r.accountName}</span>
                </td>
                <td className="text-xs uppercase tracking-wide text-[var(--ink-400)]">
                  {r.accountType}
                </td>
                <td className="td-num">{r.debit !== "0.00" ? fmtMoney(r.debit) : ""}</td>
                <td className="td-num">{r.credit !== "0.00" ? fmtMoney(r.credit) : ""}</td>
              </tr>
            ))}
            {tb.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-[var(--ink-400)]">
                  No posted activity as at {asOf}.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="text-right text-xs uppercase tracking-wide">
                Totals
              </td>
              <td className="td-num">{fmtMoney(tb.totalDebits)}</td>
              <td className="td-num">{fmtMoney(tb.totalCredits)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="kbd-hint mt-2">As at {asOf} · live ledger read</p>
    </div>
  );
}
