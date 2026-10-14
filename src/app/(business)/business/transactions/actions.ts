"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { requireModuleEdit } from "@/services/permissions";
import { postQuickTransaction, type QuickTransactionKind } from "@/services/business-transactions";
import { postJournalEntry } from "@/services/journal";

async function owner() {
  const ctx = await portalContext();
  if (ctx.user.role !== "business_admin") throw new Error("Business owner access required");
  await requireModuleEdit(ctx.user,ctx.entityId,"journal");
  return ctx;
}

export async function postQuickTransactionAction(form: FormData) {
  const ctx = await owner();
  try {
    await postQuickTransaction({ entityId: ctx.entityId,
      kind: String(form.get("kind")) as QuickTransactionKind,
      date: String(form.get("date")), description: String(form.get("description") ?? ""),
      bankAccountId: String(form.get("bankAccountId")), counterAccountId: String(form.get("counterAccountId")),
      amount: String(form.get("amount")), reference: String(form.get("reference") ?? "") },ctx.user.id);
  } catch (error) { redirect(`/business/transactions?error=${encodeURIComponent(error instanceof Error ? error.message : "Could not post transaction")}`); }
  revalidatePath("/business");
  redirect("/business/transactions?saved=1");
}

export async function postManualJournalAction(form: FormData) {
  const ctx = await owner();
  const lines = Array.from({ length: 6 }, (_, i) => ({ accountId: String(form.get(`accountId${i}`) ?? ""),
    debit: String(form.get(`debit${i}`) ?? ""), credit: String(form.get(`credit${i}`) ?? ""),
    description: String(form.get(`lineDescription${i}`) ?? "") }))
    .filter(line => line.accountId && (line.debit || line.credit));
  try {
    await postJournalEntry({ entityId: ctx.entityId, date: String(form.get("date")),
      description: String(form.get("description") ?? ""), reference: String(form.get("reference") ?? "") || undefined,
      sourceModule: "manual", lines },ctx.user.id);
  } catch (error) { redirect(`/business/transactions?error=${encodeURIComponent(error instanceof Error ? error.message : "Could not post journal entry")}`); }
  revalidatePath("/business");
  redirect("/business/transactions?saved=1");
}
