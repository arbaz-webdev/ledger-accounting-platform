"use client";

import { useActionState } from "react";
import { createAccountAction, type CoaFormState } from "./actions";
import { IconPlus } from "@/components/icons";

export function NewAccountForm({ entityId }: { entityId: string }) {
  const [state, formAction, pending] = useActionState<CoaFormState, FormData>(
    createAccountAction,
    {}
  );

  return (
    <form action={formAction} className="card flex flex-wrap items-end gap-3 p-4">
      <input type="hidden" name="entityId" value={entityId} />
      <div className="w-28">
        <label className="field-label">Number</label>
        <input name="accountNumber" required placeholder="6110" className="input" />
      </div>
      <div className="min-w-52 flex-1">
        <label className="field-label">Name</label>
        <input name="name" required placeholder="Office Supplies" className="input" />
      </div>
      <div className="w-52">
        <label className="field-label">Type</label>
        <select name="type" className="select">
          <option value="asset">Asset (1xxx)</option>
          <option value="liability">Liability (2xxx)</option>
          <option value="equity">Equity (3xxx)</option>
          <option value="revenue">Revenue (4xxx)</option>
          <option value="cogs">COGS (5xxx)</option>
          <option value="expense">Expense (6xxx)</option>
          <option value="other_income">Other Income (7xxx)</option>
          <option value="other_expense">Other Expense (8xxx)</option>
          <option value="tax">Tax (9xxx)</option>
        </select>
      </div>
      <button disabled={pending} className="btn btn-primary">
        <IconPlus className="h-4 w-4" />
        {pending ? "Adding…" : "Add account"}
      </button>
      {state.error && <span className="text-[0.8125rem] text-[var(--negative)]">{state.error}</span>}
    </form>
  );
}
