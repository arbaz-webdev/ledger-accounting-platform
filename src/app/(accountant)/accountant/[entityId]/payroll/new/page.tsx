import { listEmployees } from "@/services/employees";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconCash } from "@/components/icons";
import { NewPayRunForm } from "./new-payrun-form";

export default async function NewPayRunPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const employees = await listEmployees(entityId, { activeOnly: true });

  return (
    <div className="fade-up">
      <PageHeader
        title="New pay run"
        sub="Defaults come from each employee's configured salary and deduction rates — edit line by line before posting."
      />

      {employees.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconCash className="h-5 w-5" />}
            title="No active employees"
            hint="Add an employee first."
            action={
              <a
                href={`/accountant/${entityId}/payroll/employees`}
                className="btn btn-secondary btn-sm"
              >
                Go to employees
              </a>
            }
          />
        </div>
      ) : (
        <NewPayRunForm
          entityId={entityId}
          employees={employees.map((e) => ({
            id: e.id,
            employeeNumber: e.employeeNumber,
            fullName: e.fullName,
            basicSalary: e.basicSalary,
            allowances: e.allowances,
          }))}
        />
      )}
    </div>
  );
}
