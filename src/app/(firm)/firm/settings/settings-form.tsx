"use client";

import { useActionState } from "react";
import { updateFirmSettingsAction, type FormState } from "../actions";

export type FirmSettings = {
  name: string;
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  fax: string;
  contactPerson: string;
  hasLogo: boolean;
};

export function FirmSettingsForm({ initial }: { initial: FirmSettings }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateFirmSettingsAction,
    {}
  );

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label">Firm name</label>
          <input name="name" defaultValue={initial.name} required className="input" />
        </div>
        <div>
          <label className="field-label">Legal name</label>
          <input name="legalName" defaultValue={initial.legalName} className="input" />
        </div>
        <div>
          <label className="field-label">Contact email</label>
          <input
            name="contactEmail"
            type="email"
            defaultValue={initial.contactEmail}
            className="input"
          />
        </div>
        <div>
          <label className="field-label">Contact phone</label>
          <input name="contactPhone" defaultValue={initial.contactPhone} className="input" />
        </div>
        <div><label className="field-label">Fax</label><input name="fax" defaultValue={initial.fax} className="input" /></div>
        <div><label className="field-label">Contact person</label><input name="contactPerson" defaultValue={initial.contactPerson} className="input" /></div>
      </div>

      <div className="border-t border-[var(--ink-100)] pt-4">
        <label className="field-label" htmlFor="firm-logo">Firm logo</label>
        {initial.hasLogo && <img src="/firm/logo" alt="Current firm logo" className="mb-3 max-h-24 max-w-48 object-contain" />}
        <input id="firm-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="input" />
        <p className="mt-1 text-xs text-[var(--ink-500)]">PNG, JPEG or WebP, up to 256 KB.</p>
        {initial.hasLogo && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="removeLogo" /> Remove current logo</label>}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--ink-100)] pt-4">
        <button disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : "Save changes"}
        </button>
        {state.error && (
          <span className="text-[0.8125rem] text-[var(--negative)]">{state.error}</span>
        )}
        {state.ok && <span className="text-[0.8125rem] text-[var(--brand-700)]">{state.ok}</span>}
      </div>
    </form>
  );
}
