import { notFound } from "next/navigation";
import { getPayRun } from "@/services/payroll";
import { listBankAccounts } from "@/services/bank-import";
import { resolveMapping } from "@/services/mappings";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { discardPayRunAction, markPayRunPaidAction } from "../actions";
import { PayRunLinesEditor } from "./payrun-lines-editor";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
};

export default async function PayRunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string; payRunId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId, payRunId } = await params;
  const { error } = await searchParams;

  const data = await getPayRun(payRunId, entityId);
  if (!data) notFound();
  const { payRun, lines, bankAccount } = data;

  const bankAccounts = payRun.status === "posted" ? await listBankAccounts(entityId) : [];
  const defaultBank =
    payRun.status === "posted" ? await resolveMapping(entityId, "default_bank").catch(() => null) : null;

  return (
    <div className="fade-up">
      <PageHeader
        title={`Pay run ${payRun.runNumber}`}
        sub={`${fmtDate(payRun.periodStart)} – ${fmtDate(payRun.periodEnd)} · pay date ${fmtDate(payRun.payDate)}`}
      >
        {payRun.status === "draft" && (
          <form action={discardPayRunAction}>
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="payRunId" value={payRun.id} />
            <button className="btn btn-secondary">Discard</button>
          </form>
        )}
        {payRun.jeId && (
          <a href={`/accountant/${entityId}/journal/${payRun.jeId}`} className="btn btn-secondary">
            View journal entry
          </a>
        )}
        {payRun.paymentJeId && (
          <a href={`/accountant/${entityId}/journal/${payRun.paymentJeId}`} className="btn btn-secondary">
            View payment entry
          </a>
        )}
      </PageHeader>

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={`badge ${STATUS_BADGE[payRun.status] ?? "badge-neutral"}`}>
          <span className="badge-dot" />
          {payRun.status}
        </span>
        <span className="text-sm text-[var(--ink-500)]">
          {lines.length} employee{lines.length === 1 ? "" : "s"} · net{" "}
          <span className="num font-semibold text-[var(--ink-900)]">{fmtMoney(payRun.netTotal)}</span>
        </span>
        {payRun.status === "paid" && bankAccount && (
          <span className="text-sm text-[var(--ink-500)]">
            Paid from {bankAccount.accountNumber} — {bankAccount.name} on{" "}
            {payRun.paidAt ? fmtDate(payRun.paidAt.toString()) : ""}
          </span>
        )}
      </div>

      {payRun.status === "draft" ? (
        <PayRunLinesEditor
          entityId={entityId}
          payRunId={payRunId}
          initialLines={lines.map((l) => ({
            employeeId: l.employeeId,
            employeeLabel: `${l.employeeNumber} — ${l.fullName}`,
            basicSalary: l.basicSalary,
            allowances: l.allowances,
            incomeTaxAmount: l.incomeTaxAmount,
            eobiEmployeeAmount: l.eobiEmployeeAmount,
            eobiEmployerAmount: l.eobiEmployerAmount,
            payrollTaxEmployerAmount: l.payrollTaxEmployerAmount,
          }))}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Income tax</th>
                <th className="text-right">EOBI (emp.)</th>
                <th className="text-right">EOBI (empl&apos;er)</th>
                <th className="text-right">Payroll tax (empl&apos;er)</th>
                <th className="text-right">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.employeeId}>
                  <td className="font-medium text-[var(--ink-800)]">
                    {l.employeeNumber} — {l.fullName}
                  </td>
                  <td className="td-num">{fmtMoney(l.grossPay)}</td>
                  <td className="td-num">{fmtMoney(l.incomeTaxAmount)}</td>
                  <td className="td-num">{fmtMoney(l.eobiEmployeeAmount)}</td>
                  <td className="td-num">{fmtMoney(l.eobiEmployerAmount)}</td>
                  <td className="td-num">{fmtMoney(l.payrollTaxEmployerAmount)}</td>
                  <td className="td-num font-medium">{fmtMoney(l.netPay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="td-num">{fmtMoney(payRun.grossTotal)}</td>
                <td className="td-num">{fmtMoney(payRun.incomeTaxTotal)}</td>
                <td className="td-num">{fmtMoney(payRun.eobiEmployeeTotal)}</td>
                <td className="td-num">{fmtMoney(payRun.eobiEmployerTotal)}</td>
                <td className="td-num">{fmtMoney(payRun.payrollTaxEmployerTotal)}</td>
                <td className="td-num">{fmtMoney(payRun.netTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {payRun.status === "posted" && (
        <form action={markPayRunPaidAction} className="card mt-4 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="payRunId" value={payRun.id} />
          <div className="min-w-56 flex-1">
            <label className="field-label">Pay from bank account</label>
            <select name="bankAccountId" className="select" defaultValue={defaultBank ?? ""}>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-brand">Mark salaries paid ({fmtMoney(payRun.netTotal)})</button>
        </form>
      )}
    </div>
  );
}
