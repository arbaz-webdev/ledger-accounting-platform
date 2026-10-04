"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { requireModuleEdit } from "@/services/permissions";
import { createContact, type ContactType } from "@/services/contacts";

export async function createBusinessContactAction(formData: FormData) {
  const ctx = await portalContext();
  const type = String(formData.get("type")) as ContactType;
  if (type !== "customer" && type !== "supplier") throw new Error("Invalid contact type");
  await requireModuleEdit(ctx.user, ctx.entityId, type === "customer" ? "sales" : "purchases");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/business/contacts?error=Name%20is%20required");
  const terms = Number(formData.get("paymentTermsDays") ?? 30);
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) throw new Error("Payment terms must be between 0 and 365 days");
  await createContact({
    entityId: ctx.entityId,
    type,
    name,
    email: String(formData.get("email") ?? "") || undefined,
    phone: String(formData.get("phone") ?? "") || undefined,
    paymentTermsDays: terms,
  }, ctx.user.id);
  revalidatePath("/business/contacts");
  redirect("/business/contacts");
}
