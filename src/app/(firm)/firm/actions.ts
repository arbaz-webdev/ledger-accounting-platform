"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFirmOwner } from "@/lib/auth";
import type { UserRole } from "@/lib/auth";
import {
  createClient,
  setClientActive,
  updateFirmSettings,
  FirmError,
} from "@/services/firms";
import { SubscriptionError } from "@/services/subscriptions";
import {
  createFirmUser,
  setUserActive,
  grantEntityAccess,
  revokeEntityAccess,
  UserAdminError,
} from "@/services/users";
import { isUniqueViolation, dbErrorMessage } from "@/db/errors";

export type FormState = { error?: string; ok?: string };

function readable(err: unknown, fallback: string): string {
  if (
    err instanceof FirmError ||
    err instanceof SubscriptionError ||
    err instanceof UserAdminError
  ) {
    return err.message;
  }
  if (isUniqueViolation(err)) return "That email is already in use";
  return dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

// ---------------------------------------------------------------------------
// Clients (the firm's customer businesses)
// ---------------------------------------------------------------------------

export async function createClientAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireFirmOwner();

  try {
    await createClient(
      user.firmId,
      {
        name: String(formData.get("name") ?? ""),
        legalName: String(formData.get("legalName") ?? "") || undefined,
        baseCurrency: String(formData.get("baseCurrency") ?? "USD"),
        fiscalYearStartMonth: String(formData.get("fiscalYearStartMonth") ?? "1"),
      },
      user.id
    );
  } catch (err) {
    return { error: readable(err, "Failed to create the client") };
  }
  revalidatePath("/firm/clients");
  return { ok: "Client created with a default chart of accounts and this year's periods." };
}

export async function setClientActiveAction(formData: FormData): Promise<void> {
  const user = await requireFirmOwner();
  const entityId = String(formData.get("entityId"));
  const makeActive = String(formData.get("makeActive")) === "true";

  try {
    await setClientActive(entityId, user.firmId, makeActive, user.id);
  } catch (err) {
    redirect(`/firm/clients?error=${encodeURIComponent(readable(err, "Failed to update client"))}`);
  }
  revalidatePath("/firm/clients");
  redirect("/firm/clients");
}

// ---------------------------------------------------------------------------
// Team (the firm's accountants and client logins)
// ---------------------------------------------------------------------------

export async function createTeamMemberAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireFirmOwner();

  const role = String(formData.get("role") ?? "") as UserRole;
  // A firm owner must not be able to mint a platform admin.
  if (role === "platform_admin") return { error: "That role cannot be assigned here" };

  try {
    await createFirmUser(
      {
        firmId: user.firmId,
        email: String(formData.get("email") ?? ""),
        fullName: String(formData.get("fullName") ?? ""),
        role,
        password: String(formData.get("password") ?? ""),
      },
      user.id
    );
  } catch (err) {
    return { error: readable(err, "Failed to create the user") };
  }
  revalidatePath("/firm/team");
  return { ok: "User created. Share the initial password with them directly." };
}

export async function setTeamMemberActiveAction(formData: FormData): Promise<void> {
  const user = await requireFirmOwner();
  const targetUserId = String(formData.get("userId"));
  const makeActive = String(formData.get("makeActive")) === "true";

  try {
    await setUserActive(targetUserId, user.firmId, makeActive, user.id);
  } catch (err) {
    redirect(`/firm/team?error=${encodeURIComponent(readable(err, "Failed to update user"))}`);
  }
  revalidatePath("/firm/team");
  redirect("/firm/team");
}

export async function grantClientAccessAction(formData: FormData): Promise<void> {
  const user = await requireFirmOwner();
  const targetUserId = String(formData.get("userId"));
  const entityId = String(formData.get("entityId"));

  try {
    await grantEntityAccess(targetUserId, entityId, user.firmId, user.id);
  } catch (err) {
    redirect(`/firm/team?error=${encodeURIComponent(readable(err, "Failed to grant access"))}`);
  }
  revalidatePath("/firm/team");
  redirect("/firm/team");
}

export async function revokeClientAccessAction(formData: FormData): Promise<void> {
  const user = await requireFirmOwner();
  const targetUserId = String(formData.get("userId"));
  const entityId = String(formData.get("entityId"));

  try {
    await revokeEntityAccess(targetUserId, entityId, user.firmId, user.id);
  } catch (err) {
    redirect(`/firm/team?error=${encodeURIComponent(readable(err, "Failed to revoke access"))}`);
  }
  revalidatePath("/firm/team");
  redirect("/firm/team");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateFirmSettingsAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireFirmOwner();
  try {
    await updateFirmSettings(
      user.firmId,
      {
        name: String(formData.get("name") ?? ""),
        legalName: String(formData.get("legalName") ?? "") || undefined,
        contactEmail: String(formData.get("contactEmail") ?? "") || undefined,
        contactPhone: String(formData.get("contactPhone") ?? "") || undefined,
      },
      user.id
    );
  } catch (err) {
    return { error: readable(err, "Failed to save settings") };
  }
  revalidatePath("/firm/settings");
  return { ok: "Saved." };
}
