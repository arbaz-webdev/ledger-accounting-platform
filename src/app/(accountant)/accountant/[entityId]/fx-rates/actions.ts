"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModuleEdit as requireModule } from "@/services/permissions";
import { setFxRate, deleteFxRate, FxError } from "@/services/fx";

export async function setFxRateAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "admin");

  const base = `/accountant/${entityId}/fx-rates`;
  try {
    await setFxRate(
      entityId,
      {
        currency: String(formData.get("currency") ?? ""),
        asOfDate: String(formData.get("asOfDate") ?? ""),
        rate: String(formData.get("rate") ?? ""),
      },
      user.id
    );
  } catch (err) {
    const message = err instanceof FxError ? err.message : "Failed to save the rate";
    redirect(`${base}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function deleteFxRateAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const rateId = String(formData.get("rateId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "admin");

  const base = `/accountant/${entityId}/fx-rates`;
  try {
    await deleteFxRate(entityId, rateId, user.id);
  } catch (err) {
    const message = err instanceof FxError ? err.message : "Failed to delete the rate";
    redirect(`${base}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(base);
  redirect(base);
}
