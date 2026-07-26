"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import { createInvoiceDraft, postInvoice, deleteInvoiceDraft, InvoiceError } from "@/services/invoices";
import { recordSettlement, SettlementError, type SettlementKind } from "@/services/settlements";
import { createContact, setContactActive } from "@/services/contacts";
import { MappingError } from "@/services/mappings";
import { JournalValidationError } from "@/services/journal";
import { triggerMessage, dbErrorMessage } from "@/db/errors";

export type FormState = { error?: string };

/** Turn any thrown error into a readable message for the UI. */
function readable(err: unknown, fallback: string): string {
  if (
    err instanceof InvoiceError ||
    err instanceof SettlementError ||
    err instanceof MappingError ||
    err instanceof JournalValidationError
  ) {
    return err.message;
  }
  return triggerMessage(err) ?? dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

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

export async function createInvoiceAction(payload: InvoicePayload): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, payload.entityId);
  await requireModule(user, payload.entityId, "sales");

  const lines = payload.lines.filter(
    (l) => l.revenueAccountId && l.description.trim() && Number(l.quantity) > 0
  );
  if (lines.length === 0) return { error: "Add at least one line with a description and account" };

  let invoiceId: string;
  try {
    const invoice = await createInvoiceDraft(
      {
        entityId: payload.entityId,
        customerId: payload.customerId,
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        notes: payload.notes,
        currency: payload.currency,
        lines,
      },
      user.id
    );
    invoiceId = invoice.id;
    if (payload.postNow) {
      await postInvoice(invoiceId, payload.entityId, user.id);
    }
  } catch (err) {
    return { error: readable(err, "Failed to create invoice") };
  }

  revalidatePath(`/accountant/${payload.entityId}/sales`);
  redirect(`/accountant/${payload.entityId}/sales/${invoiceId}`);
}

export async function postInvoiceAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const invoiceId = String(formData.get("invoiceId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "sales");

  const base = `/accountant/${entityId}/sales/${invoiceId}`;
  try {
    await postInvoice(invoiceId, entityId, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to post invoice"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function discardInvoiceAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const invoiceId = String(formData.get("invoiceId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "sales");

  try {
    await deleteInvoiceDraft(invoiceId, entityId, user.id);
  } catch (err) {
    redirect(
      `/accountant/${entityId}/sales/${invoiceId}?error=${encodeURIComponent(
        readable(err, "Failed to discard invoice")
      )}`
    );
  }
  revalidatePath(`/accountant/${entityId}/sales`);
  redirect(`/accountant/${entityId}/sales`);
}

export async function settleInvoiceAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const invoiceId = String(formData.get("invoiceId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "sales");

  const kind = String(formData.get("kind")) as SettlementKind;
  const base = `/accountant/${entityId}/sales/${invoiceId}`;
  try {
    await recordSettlement(
      {
        entityId,
        kind,
        invoiceId,
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

export async function createCustomerAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "sales");

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type")) === "supplier" ? "supplier" : "customer";
  if (!name) redirect(`/accountant/${entityId}/contacts?error=${encodeURIComponent("Name is required")}`);

  await createContact(
    {
      entityId,
      type,
      name,
      email: String(formData.get("email") ?? "") || undefined,
      phone: String(formData.get("phone") ?? "") || undefined,
      paymentTermsDays: Number(formData.get("paymentTermsDays")) || 30,
    },
    user.id
  );
  revalidatePath(`/accountant/${entityId}/contacts`);
}

export async function toggleContactAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const contactId = String(formData.get("contactId"));
  const makeActive = String(formData.get("makeActive")) === "true";
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "sales");

  await setContactActive(contactId, entityId, makeActive, user.id);
  revalidatePath(`/accountant/${entityId}/contacts`);
}
