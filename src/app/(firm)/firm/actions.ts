"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFirmOwner } from "@/lib/auth";
import type { UserRole } from "@/lib/auth";
import {
  createClient,
  setClientActive,
  updateFirmSettings,
  createFirmBooks,
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

export async function createFirmBooksAction(form: FormData) {
  const user = await requireFirmOwner();
  try { await createFirmBooks(user.firmId, String(form.get("currency") ?? "USD"), user.id); }
  catch (error) { redirect(`/firm?error=${encodeURIComponent(readable(error, "Could not create firm books"))}`); }
  revalidatePath("/firm");
  redirect("/firm?books=ready");
}

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
    const file = formData.get("logo");
    let logo: { data: Buffer; mime: string } | undefined;
    if (file instanceof File && file.size > 0) {
      if (file.size > 256_000) return { error: "Logo must be smaller than 256 KB" };
      const data = Buffer.from(await file.arrayBuffer());
      const mime = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
        : data.subarray(0, 3).equals(Buffer.from([255,216,255])) ? "image/jpeg"
        : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "";
      if (!mime) return { error: "Upload a valid PNG, JPEG or WebP logo" };
      logo = { data, mime };
    }
    await updateFirmSettings(
      user.firmId,
      {
        name: String(formData.get("name") ?? ""),
        legalName: String(formData.get("legalName") ?? "") || undefined,
        contactEmail: String(formData.get("contactEmail") ?? "") || undefined,
        contactPhone: String(formData.get("contactPhone") ?? "") || undefined,
        fax: String(formData.get("fax") ?? "") || undefined,
        contactPerson: String(formData.get("contactPerson") ?? "") || undefined,
        logo,
        removeLogo: formData.get("removeLogo") === "on",
      },
      user.id
    );
  } catch (err) {
    return { error: readable(err, "Failed to save settings") };
  }
  revalidatePath("/firm/settings");
  revalidatePath("/firm");
  return { ok: "Saved." };
}
