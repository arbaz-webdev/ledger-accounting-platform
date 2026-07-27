"use client";

import { useActionState } from "react";
import { createPlanAction, type FormState } from "../actions";
import { IconPlus } from "@/components/icons";

export function NewPlanForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createPlanAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="field-label">Code</label>
          <input name="code" required placeholder="growth" className="input acct" />
        </div>
        <div>
          <label className="field-label">Name</label>
          <input name="name" required placeholder="Growth" className="input" />
        </div>
        <div>
          <label className="field-label">Price / month</label>
          <input name="monthlyPrice" inputMode="decimal" defaultValue="0" className="input num text-right" />
        </div>
        <div>
          <label className="field-label">Currency</label>
          <input name="currency" defaultValue="USD" maxLength={3} className="input acct uppercase" />
        </div>
        <div>
          <label className="field-label">Max clients</label>
          <input name="maxEntities" inputMode="numeric" placeholder="unlimited" className="input num text-right" />
        </div>
        <div>
          <label className="field-label">Max users</label>
          <input name="maxUsers" inputMode="numeric" placeholder="unlimited" className="input num text-right" />
        </div>
        <div>
          <label className="field-label">Sort order</label>
          <input name="sortOrder" inputMode="numeric" defaultValue="100" className="input num text-right" />
        </div>
        <div className="lg:col-span-4">
          <label className="field-label">Description</label>
          <input name="description" placeholder="Who this plan is for" className="input" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          {pending ? "Creating…" : "Create plan"}
        </button>
        {state.error && (
          <span className="text-[0.8125rem] text-[var(--negative)]">{state.error}</span>
        )}
        {state.ok && <span className="text-[0.8125rem] text-[var(--brand-700)]">{state.ok}</span>}
      </div>
    </form>
  );
}
