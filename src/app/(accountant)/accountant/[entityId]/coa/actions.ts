"use server";

import { revalidatePath } from "next/cache";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import { createAccount, updateAccount, type AccountType } from "@/services/coa";
import { isUniqueViolation } from "@/db/errors";

export type CoaFormState = { error?: string; ok?: boolean };

export async function createAccountAction(
  _prev: CoaFormState,
  formData: FormData
): Promise<CoaFormState> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "coa");

  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as AccountType;
  if (!accountNumber || !name || !type) return { error: "Number, name and type are required" };

  try {
    await createAccount({ entityId, accountNumber, name, type }, user.id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: `Account number ${accountNumber} already exists` };
    }
    return { error: err instanceof Error ? err.message : "Failed to create account" };
  }
  revalidatePath(`/accountant/${entityId}/coa`);
  return { ok: true };
}

export async function toggleAccountActiveAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const accountId = String(formData.get("accountId"));
  const makeActive = String(formData.get("makeActive")) === "true";
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "coa");

  await updateAccount(accountId, entityId, { isActive: makeActive }, user.id);
  revalidatePath(`/accountant/${entityId}/coa`);
}
