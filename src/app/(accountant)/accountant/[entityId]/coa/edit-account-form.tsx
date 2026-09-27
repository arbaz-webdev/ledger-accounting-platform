"use client";
import { useActionState } from "react";
import { editAccountAction, type CoaFormState } from "./actions";

export function EditAccountForm({ entityId, account, canReview }: {
  entityId: string; account: { id: string; name: string; accountNumber: string; type: string; subType: string | null }; canReview: boolean;
}) {
  const [state, action, pending] = useActionState<CoaFormState, FormData>(editAccountAction, {});
  const correction = account.type !== "asset" && (account.subType === "suspense" ||
    (account.accountNumber === "2400" && account.name === "Input Tax Receivable" && account.subType === "tax"));
  return <details className="text-left">
    <summary className="cursor-pointer text-sm">Edit / review</summary>
    <form action={action} className="mt-2 min-w-60 space-y-2">
      <input type="hidden" name="entityId" value={entityId} /><input type="hidden" name="accountId" value={account.id} />
      <label className="field-label" htmlFor={`name-${account.id}`}>Account name</label>
      <input id={`name-${account.id}`} className="input" name="name" required defaultValue={account.name} maxLength={200} />
      {correction && <p className="text-sm">Classification review needed: {account.type} → current asset. Changing this alters historical report presentation, not posted journals.</p>}
      {correction && canReview && <>
        <label className="flex gap-2 text-sm"><input name="classificationReview" type="checkbox" /> Apply reviewed classification correction</label>
        <label className="field-label" htmlFor={`review-${account.id}`}>Accounting review reason (required for correction)</label>
        <input id={`review-${account.id}`} name="reason" className="input" maxLength={500} />
        <label className="flex gap-2 text-sm"><input name="confirmed" type="checkbox" /> I reviewed the historical presentation impact</label>
      </>}
      <button className="btn btn-secondary btn-sm" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      {state.error && <p role="alert" className="text-sm text-[var(--negative)]">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm">Account updated.</p>}
    </form>
  </details>;
}
