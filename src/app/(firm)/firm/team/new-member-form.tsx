"use client";

import { useActionState } from "react";
import { createTeamMemberAction, type FormState } from "../actions";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { IconPlus } from "@/components/icons";

export function NewMemberForm({ atLimit }: { atLimit: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTeamMemberAction,
    {}
  );
  const groups = [...new Set(ASSIGNABLE_ROLES.map((r) => r.group))];

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">Full name</label>
          <input name="fullName" required placeholder="Sara Siddiqui" className="input" />
        </div>
        <div>
          <label className="field-label">Email</label>
          <input name="email" type="email" required placeholder="sara@yourfirm.test" className="input" />
        </div>
        <div>
          <label className="field-label">Role</label>
          <select name="role" className="select" defaultValue="accountant_staff">
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {ASSIGNABLE_ROLES.filter((r) => r.group === g).map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Initial password</label>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            className="input"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending || atLimit} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          {pending ? "Creating…" : "Add user"}
        </button>
        <span className="kbd-hint">
          Business roles get the read-only client portal; accountant roles get the books.
        </span>
        {state.error && (
          <span className="text-[0.8125rem] text-[var(--negative)]">{state.error}</span>
        )}
        {state.ok && <span className="text-[0.8125rem] text-[var(--brand-700)]">{state.ok}</span>}
      </div>
    </form>
  );
}
