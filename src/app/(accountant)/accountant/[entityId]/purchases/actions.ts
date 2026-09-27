"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModuleEdit as requireModule } from "@/services/permissions";
import { createBillDraft, postBill, deleteBillDraft, BillError } from "@/services/bills";
import { recordSettlement, SettlementError, type SettlementKind } from "@/services/settlements";
import { MappingError } from "@/services/mappings";
import { JournalValidationError } from "@/services/journal";
import { triggerMessage, dbErrorMessage } from "@/db/errors";

export type FormState = { error?: string };

function readable(err: unknown, fallback: string): string {
  if (
    err instanceof BillError ||
    err instanceof SettlementError ||
    err instanceof MappingError ||
    err instanceof JournalValidationError
  ) {
    return err.message;
  }
  return triggerMessage(err) ?? dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

type BillPayload = {
  entityId: string;
  supplierId: string;
  supplierReference?: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  currency?: string;
  postNow: boolean;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    expenseAccountId: string;
    taxRate: string;
    itemId?: string;
  }[];
};

export async function createBillAction(payload: BillPayload): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, payload.entityId);
  await requireModule(user, payload.entityId, "purchases");

  const lines = payload.lines.filter(
    (l) => l.expenseAccountId && l.description.trim() && Number(l.quantity) > 0
  );
  if (lines.length === 0) return { error: "Add at least one line with a description and account" };

  let billId: string;
  try {
    const bill = await createBillDraft(
      {
        entityId: payload.entityId,
        supplierId: payload.supplierId,
        supplierReference: payload.supplierReference,
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        notes: payload.notes,
        currency: payload.currency,
        lines,
      },
      user.id
    );
    billId = bill.id;
    if (payload.postNow) {
      await postBill(billId, payload.entityId, user.id);
    }
  } catch (err) {
    return { error: readable(err, "Failed to create bill") };
  }

  revalidatePath(`/accountant/${payload.entityId}/purchases`);
  redirect(`/accountant/${payload.entityId}/purchases/${billId}`);
}

export async function postBillAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "purchases");

  const base = `/accountant/${entityId}/purchases/${billId}`;
  try {
    await postBill(billId, entityId, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to post bill"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function discardBillAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "purchases");

  try {
    await deleteBillDraft(billId, entityId, user.id);
  } catch (err) {
    redirect(
      `/accountant/${entityId}/purchases/${billId}?error=${encodeURIComponent(
        readable(err, "Failed to discard bill")
      )}`
    );
  }
  revalidatePath(`/accountant/${entityId}/purchases`);
  redirect(`/accountant/${entityId}/purchases`);
}

export async function settleBillAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "purchases");

  const kind = String(formData.get("kind")) as SettlementKind;
  const base = `/accountant/${entityId}/purchases/${billId}`;
  try {
    await recordSettlement(
      {
        entityId,
        kind,
        billId,
        date: String(formData.get("date")),
        amount: String(formData.get("amount")),
        bankAccountId: kind === "payment" ? String(formData.get("bankAccountId")) : undefined,
        reference: String(formData.get("reference") ?? "") || undefined,
      },
      user.id
    );
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to record settlement"))}`);
  }
  revalidatePath(base);
  redirect(base);
}
