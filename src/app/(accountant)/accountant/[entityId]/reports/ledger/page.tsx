import { listAccounts } from "@/services/coa";
import { getGeneralLedger } from "@/services/reports";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconRows } from "@/components/icons";

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ account?: string; from?: string; to?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const accounts = await listAccounts(entityId);

  const year = todayIso().slice(0, 4);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${year}-01-01`;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayIso();
  const accountId = sp.account && accounts.some((a) => a.id === sp.account) ? sp.account : null;

  const report = accountId ? await getGeneralLedger(entityId, accountId, from, to) : null;
  const account = accounts.find((a) => a.id === accountId);

  return (
    <div className="fade-up">
      <PageHeader title="General Ledger" sub="Account-level movements with running balance." />

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-64 flex-1">
          <label className="field-label">Account</label>
          <select name="account" defaultValue={accountId ?? ""} className="select">
            <option value="">Select account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">From</label>
          <input type="date" name="from" defaultValue={from} className="input w-40" />
        </div>
        <div>
          <label className="field-label">To</label>
          <input type="date" name="to" defaultValue={to} className="input w-40" />
        </div>
        <button className="btn btn-primary">Run</button>
      </form>

      {!report || !account ? (
        <div className="card mt-4">
          <EmptyState
            icon={<IconRows className="h-5 w-5" />}
            title="Pick an account to view its ledger"
            hint="You'll see the opening balance, every posted movement, and a running balance."
          />
        </div>
      ) : (
        <div className="card mt-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ink-100)] px-5 py-3.5">
            <div>
              <span className="acct mr-2">{account.accountNumber}</span>
              <span className="text-sm font-semibold text-[var(--ink-900)]">{account.name}</span>
            </div>
            <div className="text-[0.8125rem] text-[var(--ink-500)]">
              Opening balance <span className="num font-medium text-[var(--ink-800)]">{fmtMoney(report.openingBalance)}</span>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>JE #</th>
                <th>Description</th>
                <th className="w-32 text-right">Debit</th>
                <th className="w-32 text-right">Credit</th>
                <th className="w-36 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l, i) => (
                <tr key={i} className="tbl-row-link">
                  <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
                  <td className="acct">
                    <a
                      href={`/accountant/${entityId}/journal/${l.jeId}`}
                      className="hover:text-[var(--brand-700)] hover:underline"
                    >
                      {l.jeNumber}
                    </a>
                  </td>
                  <td className="max-w-[280px] truncate">{l.description}</td>
                  <td className="td-num">{l.debit !== "0.00" ? fmtMoney(l.debit) : ""}</td>
                  <td className="td-num">{l.credit !== "0.00" ? fmtMoney(l.credit) : ""}</td>
                  <td className="td-num font-medium">{fmtMoney(l.runningBalance)}</td>
                </tr>
              ))}
              {report.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--ink-400)]">
                    No posted movements in this range.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right text-xs uppercase tracking-wide">
                  Closing balance
                </td>
                <td className="td-num">{fmtMoney(report.closingBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
