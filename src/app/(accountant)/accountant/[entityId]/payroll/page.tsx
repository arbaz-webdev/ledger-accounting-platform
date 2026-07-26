import { listPayRuns } from "@/services/payroll";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconCash, IconPlus } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
};

export default async function PayrollPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const runs = await listPayRuns(entityId);

  return (
    <div className="fade-up">
      <PageHeader title="Pay runs" sub={`${runs.length} pay runs`}>
        <a href={`/accountant/${entityId}/payroll/employees`} className="btn btn-secondary">
          Employees
        </a>
        <a href={`/accountant/${entityId}/payroll/new`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New pay run
        </a>
      </PageHeader>

      <div className="card overflow-x-auto">
        {runs.length === 0 ? (
          <EmptyState
            icon={<IconCash className="h-5 w-5" />}
            title="No pay runs yet"
            hint="Create a pay run for a period — it pulls defaults from each employee's configured salary and deductions."
            action={
              <a href={`/accountant/${entityId}/payroll/new`} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                New pay run
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Period</th>
                <th>Pay date</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Net</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="tbl-row-link">
                  <td className="acct">
                    <a
                      href={`/accountant/${entityId}/payroll/${r.id}`}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {r.runNumber}
                    </a>
                  </td>
                  <td className="whitespace-nowrap">
                    {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(r.payDate)}</td>
                  <td className="td-num">{fmtMoney(r.grossTotal)}</td>
                  <td className="td-num font-medium">{fmtMoney(r.netTotal)}</td>
                  <td className="text-right">
                    <span className={`badge ${STATUS_BADGE[r.status] ?? "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
