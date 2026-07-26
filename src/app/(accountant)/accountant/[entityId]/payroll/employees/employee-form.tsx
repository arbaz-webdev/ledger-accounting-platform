"use client";

import { useState, useTransition } from "react";
import { createEmployeeAction, updateEmployeeAction } from "../actions";

export type EmployeeDraft = {
  fullName: string;
  email: string;
  phone: string;
  hireDate: string;
  payFrequency: "monthly" | "biweekly" | "weekly";
  basicSalary: string;
  allowances: string;
  incomeTaxRate: string;
  eobiEmployeeAmount: string;
  eobiEmployerAmount: string;
  payrollTaxEmployerRate: string;
};

const empty = (): EmployeeDraft => ({
  fullName: "",
  email: "",
  phone: "",
  hireDate: new Date().toISOString().slice(0, 10),
  payFrequency: "monthly",
  basicSalary: "",
  allowances: "0",
  incomeTaxRate: "0",
  eobiEmployeeAmount: "0",
  eobiEmployerAmount: "0",
  payrollTaxEmployerRate: "0",
});

function EmployeeFields({
  draft,
  set,
}: {
  draft: EmployeeDraft;
  set: (patch: Partial<EmployeeDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className="field-label">Full name</label>
        <input
          value={draft.fullName}
          onChange={(e) => set({ fullName: e.target.value })}
          placeholder="Fatima Ali"
          className="input"
        />
      </div>
      <div>
        <label className="field-label">Email</label>
        <input value={draft.email} onChange={(e) => set({ email: e.target.value })} className="input" />
      </div>
      <div>
        <label className="field-label">Phone</label>
        <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} className="input" />
      </div>
      <div>
        <label className="field-label">Hire date</label>
        <input
          type="date"
          value={draft.hireDate}
          onChange={(e) => set({ hireDate: e.target.value })}
          className="input"
        />
      </div>
      <div>
        <label className="field-label">Pay frequency</label>
        <select
          value={draft.payFrequency}
          onChange={(e) => set({ payFrequency: e.target.value as EmployeeDraft["payFrequency"] })}
          className="select"
        >
          <option value="monthly">Monthly</option>
          <option value="biweekly">Biweekly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <div>
        <label className="field-label">Basic salary (per pay period)</label>
        <input
          inputMode="decimal"
          value={draft.basicSalary}
          onChange={(e) => set({ basicSalary: e.target.value })}
          placeholder="0.00"
          className="input num"
        />
      </div>
      <div>
        <label className="field-label">Allowances (per pay period)</label>
        <input
          inputMode="decimal"
          value={draft.allowances}
          onChange={(e) => set({ allowances: e.target.value })}
          className="input num"
        />
      </div>
      <div>
        <label className="field-label">Income tax rate (% of gross)</label>
        <input
          inputMode="decimal"
          value={draft.incomeTaxRate}
          onChange={(e) => set({ incomeTaxRate: e.target.value })}
          className="input num"
        />
      </div>
      <div>
        <label className="field-label">Payroll tax rate, employer (% of gross)</label>
        <input
          inputMode="decimal"
          value={draft.payrollTaxEmployerRate}
          onChange={(e) => set({ payrollTaxEmployerRate: e.target.value })}
          className="input num"
        />
      </div>
      <div>
        <label className="field-label">EOBI — employee share (fixed)</label>
        <input
          inputMode="decimal"
          value={draft.eobiEmployeeAmount}
          onChange={(e) => set({ eobiEmployeeAmount: e.target.value })}
          className="input num"
        />
      </div>
      <div>
        <label className="field-label">EOBI — employer share (fixed)</label>
        <input
          inputMode="decimal"
          value={draft.eobiEmployerAmount}
          onChange={(e) => set({ eobiEmployerAmount: e.target.value })}
          className="input num"
        />
      </div>
    </div>
  );
}

export function NewEmployeeForm({ entityId }: { entityId: string }) {
  const [draft, setDraft] = useState<EmployeeDraft>(empty());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(patch: Partial<EmployeeDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createEmployeeAction(entityId, draft);
      if (result?.error) setError(result.error);
    });
  }

  const valid = draft.fullName.trim() !== "" && draft.hireDate !== "" && Number(draft.basicSalary) >= 0;

  return (
    <div className="space-y-4">
      <EmployeeFields draft={draft} set={set} />
      <div className="flex items-center gap-3">
        <button disabled={pending || !valid} onClick={submit} className="btn btn-primary">
          {pending ? "Adding…" : "Add employee"}
        </button>
        {error && <span className="text-[0.8125rem] text-[var(--negative)]">{error}</span>}
      </div>
    </div>
  );
}

export function EditEmployeeForm({
  entityId,
  employeeId,
  initial,
}: {
  entityId: string;
  employeeId: string;
  initial: EmployeeDraft;
}) {
  const [draft, setDraft] = useState<EmployeeDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(patch: Partial<EmployeeDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateEmployeeAction(employeeId, entityId, draft);
      if (result?.error) setError(result.error);
    });
  }

  const valid = draft.fullName.trim() !== "" && draft.hireDate !== "" && Number(draft.basicSalary) >= 0;

  return (
    <div className="card space-y-4 p-5">
      <EmployeeFields draft={draft} set={set} />
      <div className="flex items-center gap-3 border-t border-[var(--ink-100)] pt-4">
        <button disabled={pending || !valid} onClick={submit} className="btn btn-primary">
          {pending ? "Saving…" : "Save changes"}
        </button>
        {error && <span className="text-[0.8125rem] text-[var(--negative)]">{error}</span>}
      </div>
    </div>
  );
}
