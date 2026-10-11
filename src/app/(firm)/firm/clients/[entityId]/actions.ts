"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFirmOwner } from "@/lib/auth";
import { updateClientSubscriptionManagement } from "@/services/client-subscriptions";

export async function saveClientSubscriptionAction(form: FormData) {
  const owner = await requireFirmOwner();
  const entityId = String(form.get("entityId"));
  try {
    await updateClientSubscriptionManagement(owner.firmId,entityId,owner.id,{
      managedBy: String(form.get("managedBy")) as "firm" | "client",
      monthlyFee: String(form.get("monthlyFee") ?? "0"),
      currency: String(form.get("currency") ?? "USD"),
      renewalOn: String(form.get("renewalOn") ?? "") || undefined,
      notes: String(form.get("notes") ?? "") || undefined,
    });
  } catch (error) { redirect(`/firm/clients/${entityId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Could not save")}`); }
  revalidatePath("/firm/clients");
  revalidatePath("/firm/reports");
  redirect(`/firm/clients/${entityId}?saved=1`);
}
