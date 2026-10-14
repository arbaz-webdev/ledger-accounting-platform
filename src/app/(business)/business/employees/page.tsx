import { redirect } from "next/navigation";
import { guardPortal } from "@/lib/business-guard";
import { listEmployees } from "@/services/employees";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createBusinessEmployeeAction } from "./actions";

export default async function BusinessEmployeesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const ctx = await guardPortal("payroll");
  if (ctx.user.role !== "business_admin") redirect("/business?denied=payroll");
  const [staff, query] = await Promise.all([listEmployees(ctx.entityId),searchParams]);
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Employees" sub="Add employees to the business payroll register." />
    {query.error && <div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    {query.saved && <div className="banner mb-4" role="status">Employee added.</div>}
    <details className="card mb-5 p-5"><summary className="cursor-pointer font-semibold">Add employee</summary>
      <form action={createBusinessEmployeeAction} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label><span className="field-label">Full name</span><input name="fullName" className="input" required /></label>
        <label><span className="field-label">Email</span><input name="email" type="email" className="input" /></label>
        <label><span className="field-label">Phone</span><input name="phone" className="input" /></label>
        <label><span className="field-label">Hire date</span><input name="hireDate" type="date" defaultValue={todayIso()} className="input" required /></label>
        <label><span className="field-label">Pay frequency</span><select name="payFrequency" className="select"><option value="monthly">Monthly</option><option value="biweekly">Biweekly</option><option value="weekly">Weekly</option></select></label>
        <label><span className="field-label">Basic salary</span><input name="basicSalary" type="number" min="0" step="0.01" className="input" required /></label>
        <label><span className="field-label">Allowances</span><input name="allowances" type="number" min="0" step="0.01" defaultValue="0" className="input" /></label>
        <label><span className="field-label">Income tax rate %</span><input name="incomeTaxRate" type="number" min="0" max="100" step="0.0001" defaultValue="0" className="input" /></label>
        <label><span className="field-label">Employer payroll tax rate %</span><input name="payrollTaxEmployerRate" type="number" min="0" max="100" step="0.0001" defaultValue="0" className="input" /></label>
        <label><span className="field-label">Employee EOBI amount</span><input name="eobiEmployeeAmount" type="number" min="0" step="0.01" defaultValue="0" className="input" /></label>
        <label><span className="field-label">Employer EOBI amount</span><input name="eobiEmployerAmount" type="number" min="0" step="0.01" defaultValue="0" className="input" /></label>
        <div className="flex items-end"><button className="btn btn-brand">Add employee</button></div>
      </form>
      <p className="mt-3 text-xs text-[var(--ink-500)]">Tax and EOBI values are entered by your accountant; the app does not calculate statutory rates.</p>
    </details>
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>Number</th><th>Name</th><th>Hire date</th><th>Frequency</th><th className="text-right">Basic salary</th><th>Status</th></tr></thead><tbody>{staff.map(e=><tr key={e.id}><td>{e.employeeNumber}</td><td>{e.fullName}</td><td>{fmtDate(e.hireDate)}</td><td>{e.payFrequency}</td><td className="td-num">{fmtMoney(e.basicSalary)}</td><td>{e.isActive?"Active":"Inactive"}</td></tr>)}</tbody></table>{!staff.length && <p className="p-4 text-sm text-[var(--ink-500)]">No employees yet.</p>}</div>
  </main>;
}
