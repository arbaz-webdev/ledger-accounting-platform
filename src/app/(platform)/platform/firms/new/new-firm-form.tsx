"use client";

import { useActionState } from "react";
import { provisionFirmAction, type FormState } from "../../actions";
import { IconPlus } from "@/components/icons";

export type PlanOption = { id: string; label: string };

export function NewFirmForm({ plans }: { plans: PlanOption[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    provisionFirmAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink-900)]">The firm</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label">Firm name</label>
            <input name="name" required placeholder="Meridian Accounting" className="input" />
          </div>
          <div>
            <label className="field-label">Legal name</label>
            <input name="legalName" placeholder="Meridian Accounting LLC" className="input" />
          </div>
          <div>
            <label className="field-label">Billing email</label>
            <input name="contactEmail" type="email" placeholder="billing@meridian.test" className="input" />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input name="contactPhone" className="input" />
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--ink-900)]">Owner login</h2>
        <p className="mb-4 text-[0.75rem] text-[var(--ink-400)]">
          The person who runs the practice. They land on the firm console and can add their own
          clients and staff.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label">Full name</label>
            <input name="ownerFullName" required placeholder="Nadia Rahman" className="input" />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input name="ownerEmail" type="email" required placeholder="nadia@meridian.test" className="input" />
          </div>
          <div>
            <label className="field-label">Initial password</label>
            <input
              name="ownerPassword"
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              className="input"
            />
            <p className="mt-1 text-[0.6875rem] text-[var(--ink-400)]">
              Share it with them directly — they should change it after signing in.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink-900)]">Subscription</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="field-label">Plan</label>
            <select name="planId" className="select" required>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Start as</label>
            <select name="status" className="select" defaultValue="trial">
              <option value="trial">Trial</option>
              <option value="active">Active (paying)</option>
            </select>
          </div>
          <div>
            <label className="field-label">Trial length (days)</label>
            <input name="trialDays" inputMode="numeric" defaultValue="14" className="input num" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending} className="btn btn-brand">
          <IconPlus className="h-4 w-4" />
          {pending ? "Provisioning…" : "Create firm"}
        </button>
        <a href="/platform/firms" className="btn btn-secondary">
          Cancel
        </a>
        {state.error && (
          <span className="text-[0.8125rem] text-[var(--negative)]">{state.error}</span>
        )}
      </div>
    </form>
  );
}
