import { notFound } from "next/navigation";
import { getEmployee } from "@/services/employees";
import { PageHeader } from "@/components/ui";
import { EditEmployeeForm } from "../employee-form";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ entityId: string; employeeId: string }>;
}) {
  const { entityId, employeeId } = await params;
  const employee = await getEmployee(employeeId, entityId);
  if (!employee) notFound();

  return (
    <div className="fade-up">
      <PageHeader title={`${employee.employeeNumber} — ${employee.fullName}`} sub="Employee details" />
      <EditEmployeeForm
        entityId={entityId}
        employeeId={employeeId}
        initial={{
          fullName: employee.fullName,
          email: employee.email ?? "",
          phone: employee.phone ?? "",
          hireDate: employee.hireDate,
          payFrequency: employee.payFrequency,
          basicSalary: employee.basicSalary,
          allowances: employee.allowances,
          incomeTaxRate: employee.incomeTaxRate,
          eobiEmployeeAmount: employee.eobiEmployeeAmount,
          eobiEmployerAmount: employee.eobiEmployerAmount,
          payrollTaxEmployerRate: employee.payrollTaxEmployerRate,
        }}
      />
    </div>
  );
}
