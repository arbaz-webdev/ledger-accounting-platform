"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { requireModuleEdit } from "@/services/permissions";
import { createBillDraft, postBill, deleteBillDraft, updateBillMetadata, voidBill } from "@/services/bills";
import { recordSettlement, type SettlementKind } from "@/services/settlements";

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

async function authorize(entityId: string) {
  const ctx = await portalContext();
  if (ctx.entityId !== entityId) throw new Error("Access denied to this entity");
  await requireModuleEdit(ctx.user, entityId, "purchases");
  return ctx.user;
}

export async function createBusinessBillAction(payload: BillPayload): Promise<{ error?: string }> {
  const user = await authorize(payload.entityId);
  const lines = payload.lines.filter((line) => line.expenseAccountId && line.description.trim() && Number(line.quantity) > 0);
  if (!lines.length) return { error: "Add at least one line with a description and account" };
  let billId: string;
  try {
    const bill = await createBillDraft({
      entityId: payload.entityId,
      supplierId: payload.supplierId,
      supplierReference: payload.supplierReference,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      notes: payload.notes,
      currency: payload.currency,
      lines,
    }, user.id);
    billId = bill.id;
    if (payload.postNow) await postBill(billId, payload.entityId, user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create bill" };
  }
  revalidatePath("/business/bills");
  redirect(`/business/bills/${billId}`);
}

export async function postBusinessBillAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  const user = await authorize(entityId);
  try {
    await postBill(billId, entityId, user.id);
  } catch (error) {
    redirect(`/business/bills/${billId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to post bill")}`);
  }
  revalidatePath("/business/bills");
  redirect(`/business/bills/${billId}`);
}

export async function discardBusinessBillAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  const user = await authorize(entityId);
  try {
    await deleteBillDraft(billId, entityId, user.id);
  } catch (error) {
    redirect(`/business/bills/${billId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to discard bill")}`);
  }
  revalidatePath("/business/bills");
  redirect("/business/bills");
}

export async function settleBusinessBillAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  const user = await authorize(entityId);
  const kind = String(formData.get("kind")) as SettlementKind;
  try {
    await recordSettlement({
      entityId,
      billId,
      kind,
      date: String(formData.get("date")),
      amount: String(formData.get("amount")),
      bankAccountId: kind === "payment" ? String(formData.get("bankAccountId")) : undefined,
      reference: String(formData.get("reference") ?? "") || undefined,
    }, user.id);
  } catch (error) {
    redirect(`/business/bills/${billId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to record payment")}`);
  }
  revalidatePath("/business/bills");
  redirect(`/business/bills/${billId}`);
}

export async function updateBusinessBillMetadataAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  const user = await authorize(entityId);
  try {
    await updateBillMetadata(billId, entityId, user.id, {
      dueDate: String(formData.get("dueDate")),
      notes: String(formData.get("notes") ?? ""),
      supplierReference: String(formData.get("supplierReference") ?? ""),
    });
  } catch (error) {
    redirect(`/business/bills/${billId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to update bill")}`);
  }
  revalidatePath("/business/bills");
  redirect(`/business/bills/${billId}`);
}

export async function voidBusinessBillAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const billId = String(formData.get("billId"));
  const user = await authorize(entityId);
  try {
    await voidBill(billId, entityId, user.id, String(formData.get("voidDate")));
  } catch (error) {
    redirect(`/business/bills/${billId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to void bill")}`);
  }
  revalidatePath("/business/bills");
  redirect(`/business/bills/${billId}`);
}
