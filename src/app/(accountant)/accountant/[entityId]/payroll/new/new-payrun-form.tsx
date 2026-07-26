"use client";

import { useMemo, useState, useTransition } from "react";
import { fmtMoney } from "@/lib/format";
import { createPayRunAction } from "../actions";

export type EmployeeOption = {
  id: string;
  employeeNumber: string;
  fullName: string;
  basicSalary: string;
  allowances: string;
};

function monthEndIso(startIso: string): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

export function NewPayRunForm({
  entityId,
  employees,
}: {
  entityId: string;
  employees: EmployeeOption[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(monthEndIso(`${today.slice(0, 7)}-01`));
  const [payDate, setPayDate] = useState(today);
  const [selected, setSelected] = useState<Set<string>>(new Set(employees.map((e) => e.id)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const grossPreview = useMemo(
    () =>
      employees
        .filter((e) => selected.has(e.id))
        .reduce((s, e) => s + Number(e.basicSalary) + Number(e.allowances), 0),
    [employees, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createPayRunAction({
        entityId,
        periodStart,
        periodEnd,
        payDate,
        employeeIds: [...selected],
      });
      if (result?.error) setError(result.error);
    });
  }

  const valid = selected.size > 0 && periodStart !== "" && periodEnd >= periodStart && payDate !== "";

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-4 border-b border-[var(--ink-100)] bg-[var(--ink-50)] p-4">
        <div className="w-40">
          <label className="field-label">Period start</label>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="input"
          />
        </div>
        <div className="w-40">
          <label className="field-label">Period end</label>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="input"
          />
        </div>
        <div className="w-40">
          <label className="field-label">Pay date</label>
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="input" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-10"></th>
              <th>Employee</th>
              <th className="text-right">Basic</th>
              <th className="text-right">Allowances</th>
              <th className="text-right">Gross</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const gross = Number(e.basicSalary) + Number(e.allowances);
              return (
                <tr key={e.id}>
                  <td className="!py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="font-medium text-[var(--ink-800)]">
                    {e.employeeNumber} — {e.fullName}
                  </td>
                  <td className="td-num">{fmtMoney(e.basicSalary)}</td>
                  <td className="td-num">{fmtMoney(e.allowances)}</td>
                  <td className="td-num">{fmtMoney(gross)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-4 py-3">
        <button disabled={pending || !valid} onClick={submit} className="btn btn-primary">
          {pending ? "Creating…" : `Create draft (${selected.size} employees)`}
        </button>
        <span className="kbd-hint">Gross preview: {fmtMoney(grossPreview)}. Amounts are editable after creation.</span>
        {error && (
          <div className="banner banner-error w-full" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
