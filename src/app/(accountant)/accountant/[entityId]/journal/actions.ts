"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import {
  postJournalEntry,
  saveDraftJournalEntry,
  postDraftJournalEntry,
  deleteDraftJournalEntry,
  voidJournalEntry,
  JournalValidationError,
  type JournalEntryInput,
} from "@/services/journal";
import { triggerMessage } from "@/db/errors";

export type JeFormState = { error?: string };

type JeFormPayload = {
  entityId: string;
  date: string;
  description: string;
  reference?: string;
  saveAs: "posted" | "draft";
  lines: { accountId: string; description?: string; debit?: string; credit?: string }[];
};

export async function submitJournalEntry(payload: JeFormPayload): Promise<JeFormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, payload.entityId);
  await requireModule(user, payload.entityId, "journal");

  const input: JournalEntryInput = {
    entityId: payload.entityId,
    date: payload.date,
    description: payload.description,
    reference: payload.reference || undefined,
    sourceModule: "manual",
    lines: payload.lines
      .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({
        accountId: l.accountId,
        description: l.description || undefined,
        debit: l.debit || 0,
        credit: l.credit || 0,
      })),
  };

  try {
    if (payload.saveAs === "posted") {
      await postJournalEntry(input, user.id);
    } else {
      await saveDraftJournalEntry(input, user.id);
    }
  } catch (err) {
    if (err instanceof JournalValidationError) return { error: err.message };
    if (err instanceof ZodError) {
      return { error: err.issues[0]?.message ?? "Invalid input" };
    }
    // A DB trigger (e.g. period locked between validation and commit) — show its reason
    const trigger = triggerMessage(err);
    if (trigger) return { error: trigger };
    return { error: err instanceof Error ? err.message : "Failed to save entry" };
  }

  revalidatePath(`/accountant/${payload.entityId}/journal`);
  redirect(`/accountant/${payload.entityId}/journal`);
}

export async function voidJournalEntryAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const jeId = String(formData.get("jeId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "journal");

  const base = `/accountant/${entityId}/journal/${jeId}`;
  try {
    await voidJournalEntry(jeId, entityId, user.id);
  } catch (err) {
    // Most likely: the entry's period is locked (DB trigger rejects the reversal).
    const message =
      triggerMessage(err) ??
      (err instanceof JournalValidationError ? err.message : "Failed to void this entry");
    redirect(`${base}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/accountant/${entityId}/journal`);
  redirect(base);
}

export async function postDraftAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const jeId = String(formData.get("jeId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "journal");

  const base = `/accountant/${entityId}/journal/${jeId}`;
  try {
    await postDraftJournalEntry(jeId, entityId, user.id);
  } catch (err) {
    const message =
      triggerMessage(err) ??
      (err instanceof JournalValidationError ? err.message : "Failed to post this draft");
    redirect(`${base}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/accountant/${entityId}/journal`);
  redirect(base);
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const jeId = String(formData.get("jeId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "journal");

  try {
    await deleteDraftJournalEntry(jeId, entityId, user.id);
  } catch (err) {
    const message =
      err instanceof JournalValidationError ? err.message : "Failed to discard this draft";
    redirect(`/accountant/${entityId}/journal/${jeId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/accountant/${entityId}/journal`);
  redirect(`/accountant/${entityId}/journal`);
}
