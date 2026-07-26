import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess, type SessionUser } from "@/lib/auth";
import { hasModule, type ModuleKey } from "@/services/permissions";

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
