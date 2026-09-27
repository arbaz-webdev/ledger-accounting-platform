"use server";

import { revalidatePath } from "next/cache";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModuleEdit as requireModule } from "@/services/permissions";
import { setMapping, seedDefaultMappings, type MappingKey } from "@/services/mappings";

export async function setMappingAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "admin");

  // Structural COA/mapping changes are a firm-admin responsibility (spec 15)
  if (user.role === "accountant_staff") {
    throw new Error("Only firm admins can change account mappings");
  }

  const key = String(formData.get("key")) as MappingKey;
  const accountId = String(formData.get("accountId"));
  await setMapping(entityId, key, accountId, user.id);
  revalidatePath(`/accountant/${entityId}/mappings`);
}

export async function seedMappingsAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "admin");

  await seedDefaultMappings(entityId);
  revalidatePath(`/accountant/${entityId}/mappings`);
}
