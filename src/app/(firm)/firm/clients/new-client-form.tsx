"use client";

import { useActionState } from "react";
import { createClientAction, type FormState } from "../actions";
import { IconPlus } from "@/components/icons";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function NewClientForm({ atLimit }: { atLimit: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createClientAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="field-label">Client name</label>
          <input name="name" required placeholder="Acme Trading Ltd" className="input" />
        </div>
        <div className="lg:col-span-2">
          <label className="field-label">Legal name</label>
          <input name="legalName" placeholder="Acme Trading Limited" className="input" />
        </div>
        <div>
          <label className="field-label">Base currency</label>
          <input
            name="baseCurrency"
            defaultValue="USD"
            maxLength={3}
            className="input acct uppercase"
          />
        </div>
        <div className="lg:col-span-2">
          <label className="field-label">Fiscal year starts</label>
          <select name="fiscalYearStartMonth" className="select" defaultValue="1">
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending || atLimit} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          {pending ? "Creating…" : "Create client"}
        </button>
        <span className="kbd-hint">
          Arrives with the default chart of accounts, this year&apos;s periods and account mappings.
        </span>
        {state.error && (
          <span className="text-[0.8125rem] text-[var(--negative)]">{state.error}</span>
        )}
        {state.ok && <span className="text-[0.8125rem] text-[var(--brand-700)]">{state.ok}</span>}
      </div>
    </form>
  );
}
