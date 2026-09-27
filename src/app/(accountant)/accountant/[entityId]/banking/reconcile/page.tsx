import { listBankAccounts } from "@/services/bank-import";
import { getReconWorkspace, listReconciliations } from "@/services/bank-recon";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBank, IconCheck } from "@/components/icons";
import { ReconForm } from "./recon-form";
import { requireAccountant } from "@/lib/auth";
import { hasModule } from "@/services/permissions";

export default async function ReconcilePage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ account?: string; date?: string; error?: string; done?: string }>;
}) {
  const { entityId } = await params;
  const user = await requireAccountant();
  const canApprove = await hasModule(user, entityId, "banking", "approve");
  const sp = await searchParams;

  const accounts = await listBankAccounts(entityId);
  if (accounts.length === 0) {
    return (
      <div className="fade-up">
        <PageHeader title="Bank reconciliation" />
        <div className="card">
          <EmptyState
            icon={<IconBank className="h-5 w-5" />}
            title="No bank accounts"
            hint="Add a cash & bank account in the Chart of Accounts first."
          />
        </div>
      </div>
    );
  }

  const accountId = accounts.find((a) => a.id === sp.account)?.id ?? accounts[0].id;
  const statementDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIso();

  const [workspace, history] = await Promise.all([
    getReconWorkspace(entityId, accountId, statementDate),
    listReconciliations(entityId),
  ]);

  return (
    <div className="fade-up">
      <PageHeader
        title="Bank reconciliation"
        sub={`${workspace.bankLabel} · matching the books to the statement`}
      >
        <form className="flex items-end gap-2">
          <div>
            <label className="field-label">Account</label>
            <select name="account" defaultValue={accountId} className="select w-52">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Statement date</label>
            <input type="date" name="date" defaultValue={statementDate} className="input w-40" />
          </div>
          <button className="btn btn-secondary">Load</button>
        </form>
      </PageHeader>

      {sp.done && (
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Reconciliation approved and locked.</span>
        </div>
      )}
      {sp.error && (
        <div className="banner banner-error mb-4" role="alert">
          {sp.error}
        </div>
      )}
      {workspace.lastReconciliation && (
        <p className="mb-4 text-[0.8125rem] text-[var(--ink-500)]">
          Last reconciled to {fmtDate(workspace.lastReconciliation.statementDate)} at{" "}
          <span className="num">{fmtMoney(workspace.lastReconciliation.statementBalance)}</span>.
        </p>
      )}

      {canApprove ? <ReconForm entityId={entityId} workspace={workspace} /> :
        <p className="banner banner-warn" role="status">Reconciliation approval requires a firm owner or administrator. You can review the workspace and reconciliation history.</p>}

      {history.length > 0 && (
        <div className="card mt-6 overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Reconciliation history</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Account</th>
                <th>Statement date</th>
                <th className="text-right">Statement balance</th>
                <th className="text-right">Book balance</th>
                <th>Approved</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <span className="acct mr-2">{h.bankNumber}</span>
                    {h.bankName}
                  </td>
                  <td>{fmtDate(h.statementDate)}</td>
                  <td className="td-num">{fmtMoney(h.statementBalance)}</td>
                  <td className="td-num">{fmtMoney(h.bookBalance)}</td>
                  <td className="whitespace-nowrap text-[var(--ink-500)]">
                    {fmtDate(h.approvedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
