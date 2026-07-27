import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess, type SessionUser } from "@/lib/auth";
import { hasModule, type ModuleKey } from "@/services/permissions";
import { firmAccessState } from "@/services/subscriptions";

/**
 * Commercial gate: a firm whose subscription is suspended/cancelled (or whose
 * account was deactivated) loses access to every portal. platform_admin is
 * exempt — they must still be able to get in and fix the subscription.
 * Returns the soft warning (trial ending, payment overdue) for banners.
 */
export async function assertFirmSubscription(user: SessionUser): Promise<string | undefined> {
  if (user.role === "platform_admin") return undefined;
  if (!user.firmId) return undefined;

  const access = await firmAccessState(user.firmId);
  if (!access.allowed) redirect("/suspended");
  return access.warning;
}

/**
 * One guard for every entity-scoped accountant route: authenticated, has
 * access to this client, and holds the module permission. Route layouts call
 * this so every nested page inherits the check; server actions call
 * `requireModule` directly so a crafted POST can never bypass the UI.
 */
export async function guardEntity(
  entityId: string,
  moduleKey: ModuleKey
): Promise<SessionUser> {
  const user = await requireAccountant();
  await assertFirmSubscription(user);

  try {
    await assertEntityAccess(user, entityId);
  } catch {
    notFound(); // don't leak which entity ids exist
  }

  if (!(await hasModule(user, entityId, moduleKey))) {
    redirect(`/accountant/${entityId}/denied?module=${moduleKey}`);
  }
  return user;
}

/** Same, but any one of the listed modules is enough (e.g. shared contacts). */
export async function guardEntityAny(
  entityId: string,
  moduleKeys: ModuleKey[]
): Promise<SessionUser> {
  const user = await requireAccountant();
  await assertFirmSubscription(user);

  try {
    await assertEntityAccess(user, entityId);
  } catch {
    notFound();
  }

  for (const key of moduleKeys) {
    if (await hasModule(user, entityId, key)) return user;
  }
  redirect(`/accountant/${entityId}/denied?module=${moduleKeys[0]}`);
}
