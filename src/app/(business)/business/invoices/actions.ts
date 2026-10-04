"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { requireModuleEdit } from "@/services/permissions";
import { createInvoiceDraft, postInvoice, deleteInvoiceDraft } from "@/services/invoices";
import { recordSettlement, type SettlementKind } from "@/services/settlements";

type InvoicePayload = {
  entityId: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  currency?: string;
  postNow: boolean;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    revenueAccountId: string;
    taxRate: string;
    itemId?: string;
  }[];
};

async function authorize(entityId: string) {
  const ctx = await portalContext();
  if (ctx.entityId !== entityId) throw new Error("Access denied to this entity");
  await requireModuleEdit(ctx.user, entityId, "sales");
  return ctx.user;
}

export async function createBusinessInvoiceAction(payload: InvoicePayload): Promise<{ error?: string }> {
  const user = await authorize(payload.entityId);
  const lines = payload.lines.filter((line) => line.revenueAccountId && line.description.trim() && Number(line.quantity) > 0);
  if (!lines.length) return { error: "Add at least one line with a description and account" };
  let invoiceId: string;
  try {
    const invoice = await createInvoiceDraft({
      entityId: payload.entityId,
      customerId: payload.customerId,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      notes: payload.notes,
      currency: payload.currency,
      lines,
    }, user.id);
    invoiceId = invoice.id;
    if (payload.postNow) await postInvoice(invoiceId, payload.entityId, user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create invoice" };
  }
  revalidatePath("/business/invoices");
  redirect(`/business/invoices/${invoiceId}`);
}

export async function postBusinessInvoiceAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const invoiceId = String(formData.get("invoiceId"));
  const user = await authorize(entityId);
  try {
    await postInvoice(invoiceId, entityId, user.id);
  } catch (error) {
    redirect(`/business/invoices/${invoiceId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to post invoice")}`);
  }
  revalidatePath("/business/invoices");
  redirect(`/business/invoices/${invoiceId}`);
}

export async function discardBusinessInvoiceAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const invoiceId = String(formData.get("invoiceId"));
  const user = await authorize(entityId);
  try {
    await deleteInvoiceDraft(invoiceId, entityId, user.id);
  } catch (error) {
    redirect(`/business/invoices/${invoiceId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to discard invoice")}`);
  }
  revalidatePath("/business/invoices");
  redirect("/business/invoices");
}

export async function settleBusinessInvoiceAction(formData: FormData) {
  const entityId = String(formData.get("entityId"));
  const invoiceId = String(formData.get("invoiceId"));
  const user = await authorize(entityId);
  const kind = String(formData.get("kind")) as SettlementKind;
  try {
    await recordSettlement({
      entityId,
      invoiceId,
      kind,
      date: String(formData.get("date")),
      amount: String(formData.get("amount")),
      bankAccountId: kind === "payment" ? String(formData.get("bankAccountId")) : undefined,
      reference: String(formData.get("reference") ?? "") || undefined,
    }, user.id);
  } catch (error) {
    redirect(`/business/invoices/${invoiceId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to record settlement")}`);
  }
  revalidatePath("/business/invoices");
  redirect(`/business/invoices/${invoiceId}`);
}
