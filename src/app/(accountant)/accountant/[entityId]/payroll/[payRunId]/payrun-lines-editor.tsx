"use client";

import { useMemo, useState, useTransition } from "react";
import Decimal from "decimal.js";
import { fmtMoney } from "@/lib/format";
import { updatePayRunLinesAction, postPayRunAction } from "../actions";

export type LineDraft = {
  employeeId: string;
  employeeLabel: string;
  basicSalary: string;
  allowances: string;
  incomeTaxAmount: string;
  eobiEmployeeAmount: string;
  eobiEmployerAmount: string;
  payrollTaxEmployerAmount: string;
};

function computeNet(l: LineDraft) {
  const gross = new Decimal(l.basicSalary || 0).plus(l.allowances || 0);
  const net = gross.minus(l.incomeTaxAmount || 0).minus(l.eobiEmployeeAmount || 0);
  return { gross, net };
}

export function PayRunLinesEditor({
  entityId,
  payRunId,
  initialLines,
}: {
  entityId: string;
  payRunId: string;
  initialLines: LineDraft[];
}) {
  const [lines, setLines] = useState<LineDraft[]>(initialLines);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(i: number, patch: Partial<LineDraft>) {
    setSaved(false);
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const totals = useMemo(() => {
    return lines.reduce(
      (s, l) => {
        const { gross, net } = computeNet(l);
        return {
          basic: s.basic.plus(l.basicSalary || 0),
          allowances: s.allowances.plus(l.allowances || 0),
          gross: s.gross.plus(gross),
          incomeTax: s.incomeTax.plus(l.incomeTaxAmount || 0),
          eobiEmployee: s.eobiEmployee.plus(l.eobiEmployeeAmount || 0),
          eobiEmployer: s.eobiEmployer.plus(l.eobiEmployerAmount || 0),
          payrollTaxEmployer: s.payrollTaxEmployer.plus(l.payrollTaxEmployerAmount || 0),
          net: s.net.plus(net),
        };
      },
      {
        basic: new Decimal(0),
        allowances: new Decimal(0),
        gross: new Decimal(0),
        incomeTax: new Decimal(0),
        eobiEmployee: new Decimal(0),
        eobiEmployer: new Decimal(0),
        payrollTaxEmployer: new Decimal(0),
        net: new Decimal(0),
      }
    );
  }, [lines]);

  const anyNegativeNet = lines.some((l) => computeNet(l).net.isNegative());

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updatePayRunLinesAction(payRunId, entityId, lines);
      if (result?.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="text-right">Basic</th>
              <th className="text-right">Allowances</th>
              <th className="text-right">Gross</th>
              <th className="text-right">Income tax</th>
              <th className="text-right">EOBI (emp.)</th>
              <th className="text-right">EOBI (empl'er)</th>
              <th className="text-right">Payroll tax (empl'er)</th>
              <th className="text-right">Net pay</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const { gross, net } = computeNet(l);
              return (
                <tr key={l.employeeId}>
                  <td className="font-medium text-[var(--ink-800)]">{l.employeeLabel}</td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={l.basicSalary}
                      onChange={(e) => update(i, { basicSalary: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={l.allowances}
                      onChange={(e) => update(i, { allowances: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="td-num">{fmtMoney(gross.toFixed(2))}</td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={l.incomeTaxAmount}
                      onChange={(e) => update(i, { incomeTaxAmount: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={l.eobiEmployeeAmount}
                      onChange={(e) => update(i, { eobiEmployeeAmount: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={l.eobiEmployerAmount}
                      onChange={(e) => update(i, { eobiEmployerAmount: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={l.payrollTaxEmployerAmount}
                      onChange={(e) => update(i, { payrollTaxEmployerAmount: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className={`td-num font-medium ${net.isNegative() ? "text-[var(--negative)]" : ""}`}>
                    {fmtMoney(net.toFixed(2))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>Total</td>
              <td className="td-num">{fmtMoney(totals.basic.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.allowances.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.gross.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.incomeTax.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.eobiEmployee.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.eobiEmployer.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.payrollTaxEmployer.toFixed(2))}</td>
              <td className="td-num">{fmtMoney(totals.net.toFixed(2))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-4 py-3">
        <button disabled={pending || anyNegativeNet} onClick={save} className="btn btn-secondary">
          {pending ? "Saving…" : "Save changes"}
        </button>

        <form action={postPayRunAction}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="payRunId" value={payRunId} />
          <button
            disabled={anyNegativeNet}
            className="btn btn-brand"
            title={saved ? "" : "Save your changes first if you edited any amounts"}
          >
            Post pay run
          </button>
        </form>

        <span className="kbd-hint">
          Posting creates one journal entry for the whole run using your account mappings.
        </span>
        {anyNegativeNet && (
          <div className="banner banner-error w-full" role="alert">
            Deductions cannot exceed gross pay for one or more employees.
          </div>
        )}
        {error && (
          <div className="banner banner-error w-full" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
