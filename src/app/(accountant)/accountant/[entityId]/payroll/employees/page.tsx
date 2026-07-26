import { listEmployees } from "@/services/employees";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtMoney, fmtDate } from "@/lib/format";
import { IconBuilding, IconPlus } from "@/components/icons";
import { NewEmployeeForm } from "./employee-form";
import { toggleEmployeeActiveAction } from "../actions";

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly",
  biweekly: "Biweekly",
  weekly: "Weekly",
};

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const employeeList = await listEmployees(entityId);
  const activeCount = employeeList.filter((e) => e.isActive).length;

  return (
    <div className="fade-up">
      <PageHeader
        title="Employees"
        sub={`${employeeList.length} employees · ${activeCount} active`}
      />

      <details className="card mb-4 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-800)]">
          <IconPlus className="mr-1 inline h-4 w-4" />
          Add employee
        </summary>
        <div className="mt-4">
          <NewEmployeeForm entityId={entityId} />
        </div>
      </details>

      <div className="card overflow-x-auto">
        {employeeList.length === 0 ? (
          <EmptyState
            icon={<IconBuilding className="h-5 w-5" />}
            title="No employees yet"
            hint="Add an employee with their basic salary and deduction rates to start running payroll."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Hired</th>
                <th>Frequency</th>
                <th className="text-right">Basic</th>
                <th className="text-right">Allowances</th>
                <th className="text-right">Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employeeList.map((e) => (
                <tr key={e.id} className={e.isActive ? "" : "opacity-55"}>
                  <td>
                    <a
                      href={`/accountant/${entityId}/payroll/employees/${e.id}`}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {e.employeeNumber} — {e.fullName}
                    </a>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(e.hireDate)}</td>
                  <td>{FREQ_LABELS[e.payFrequency]}</td>
                  <td className="td-num">{fmtMoney(e.basicSalary)}</td>
                  <td className="td-num">{fmtMoney(e.allowances)}</td>
                  <td className="text-right">
                    <span className={`badge ${e.isActive ? "badge-posted" : "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {e.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="text-right">
                    <form action={toggleEmployeeActiveAction} className="inline">
                      <input type="hidden" name="entityId" value={entityId} />
                      <input type="hidden" name="employeeId" value={e.id} />
                      <input type="hidden" name="makeActive" value={String(!e.isActive)} />
                      <button className="btn btn-ghost btn-sm">
                        {e.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
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
