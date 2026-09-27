import { listAccounts } from "@/services/coa";
import { NewAccountForm } from "./new-account-form";
import { toggleAccountActiveAction } from "./actions";
import { PageHeader } from "@/components/ui";
import { EditAccountForm } from "./edit-account-form";
import { requireAccountant } from "@/lib/auth";

const TYPE_LABELS: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  cogs: "COGS",
  expense: "Expense",
  other_income: "Other Income",
  other_expense: "Other Expense",
  tax: "Tax",
};

export default async function CoaPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const accounts = await listAccounts(entityId);
  const user = await requireAccountant();
  const canReview = ["platform_admin", "firm_owner", "firm_admin"].includes(user.role);
  const activeCount = accounts.filter((a) => a.isActive).length;

  return (
    <div className="fade-up">
      <PageHeader
        title="Chart of Accounts"
        sub={`${accounts.length} accounts · ${activeCount} active · system accounts cannot be deleted`}
      />

      <NewAccountForm entityId={entityId} />

      <div className="card mt-4 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Number</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={`tbl-row-link ${a.isActive ? "" : "opacity-55"}`}>
                <td className="acct">{a.accountNumber}</td>
                <td>
                  <span className="font-medium text-[var(--ink-800)]">{a.name}</span>
                  {a.isSystem && <span className="badge badge-neutral ml-2">System</span>}
                </td>
                <td className="text-[var(--ink-500)]">{TYPE_LABELS[a.type]}</td>
                <td>
                  {a.isActive ? (
                    <span className="badge badge-posted">
                      <span className="badge-dot" />
                      Active
                    </span>
                  ) : (
                    <span className="badge badge-neutral">
                      <span className="badge-dot" />
                      Inactive
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <EditAccountForm entityId={entityId} account={a} canReview={canReview} />
                  {!a.isSystem && (
                    <form action={toggleAccountActiveAction} className="inline">
                      <input type="hidden" name="entityId" value={entityId} />
                      <input type="hidden" name="accountId" value={a.id} />
                      <input type="hidden" name="makeActive" value={String(!a.isActive)} />
                      <button className="btn btn-ghost btn-sm">
                        {a.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
