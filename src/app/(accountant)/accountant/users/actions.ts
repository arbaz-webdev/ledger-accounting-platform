"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant } from "@/lib/auth";
import type { UserRole } from "@/lib/auth";
import {
  createFirmUser,
  setUserActive,
  grantEntityAccess,
  revokeEntityAccess,
  UserAdminError,
} from "@/services/users";
import { setEntityPermissions, MODULE_DEFS, roleAllows, type ModuleKey } from "@/services/permissions";
import { isUniqueViolation } from "@/db/errors";

export type FormState = { error?: string; ok?: string };

/** Only firm admins administer users; staff never reach these actions. */
async function requireFirmAdmin() {
  const user = await requireAccountant();
  if (user.role !== "firm_admin" && user.role !== "platform_admin") {
    throw new Error("Only firm admins can manage users");
  }
  if (!user.firmId) throw new Error("Your account is not attached to a firm");
  return user;
}

function readable(err: unknown, fallback: string): string {
  if (err instanceof UserAdminError) return err.message;
  if (isUniqueViolation(err)) return "A user with that email already exists";
  return err instanceof Error ? err.message : fallback;
}

export async function createUserAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireFirmAdmin();

  try {
    await createFirmUser(
      {
        firmId: user.firmId!,
        email: String(formData.get("email") ?? ""),
        fullName: String(formData.get("fullName") ?? ""),
        role: String(formData.get("role") ?? "") as UserRole,
        password: String(formData.get("password") ?? ""),
      },
      user.id
    );
  } catch (err) {
    return { error: readable(err, "Failed to create the user") };
  }
  revalidatePath("/accountant/users");
  return { ok: "User created. Ask them to change the initial password after signing in." };
}

export async function toggleUserActiveAction(formData: FormData): Promise<void> {
  const user = await requireFirmAdmin();
  const targetUserId = String(formData.get("userId"));
  const makeActive = String(formData.get("makeActive")) === "true";

  try {
    await setUserActive(targetUserId, user.firmId!, makeActive, user.id);
  } catch (err) {
    redirect(`/accountant/users?error=${encodeURIComponent(readable(err, "Failed to update"))}`);
  }
  revalidatePath("/accountant/users");
  redirect("/accountant/users");
}

export async function grantAccessAction(formData: FormData): Promise<void> {
  const user = await requireFirmAdmin();
  const targetUserId = String(formData.get("userId"));
  const entityId = String(formData.get("entityId"));

  const base = `/accountant/users/${targetUserId}`;
  try {
    await grantEntityAccess(targetUserId, entityId, user.firmId!, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to grant access"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function revokeAccessAction(formData: FormData): Promise<void> {
  const user = await requireFirmAdmin();
  const targetUserId = String(formData.get("userId"));
  const entityId = String(formData.get("entityId"));

  const base = `/accountant/users/${targetUserId}`;
  try {
    await revokeEntityAccess(targetUserId, entityId, user.firmId!, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to revoke access"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

/** Save one row of the permissions matrix (a user × entity). */
export async function savePermissionsAction(formData: FormData): Promise<void> {
  const user = await requireFirmAdmin();
  const targetUserId = String(formData.get("userId"));
  const entityId = String(formData.get("entityId"));
  const targetRole = String(formData.get("targetRole")) as UserRole;

  // Only persist modules the target's role may hold at all — the role gate is
  // re-applied at read time too, so this is belt and braces.
  const permissions: Record<string, boolean> = {};
  for (const def of MODULE_DEFS) {
    if (!roleAllows(targetRole, def.key as ModuleKey)) continue;
    permissions[def.key] = formData.get(`perm_${def.key}`) === "on";
  }

  const base = `/accountant/users/${targetUserId}`;
  try {
    await setEntityPermissions(targetUserId, entityId, permissions, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to save permissions"))}`);
  }
  revalidatePath(base);
  redirect(base);
}
