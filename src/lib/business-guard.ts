import "server-only";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, userEntityAccess } from "@/db/schema";
import { requireBusinessUser, type SessionUser } from "@/lib/auth";
import { hasModule, allowedModules, type ModuleKey } from "@/services/permissions";
import { firmAccessState } from "@/services/subscriptions";

/**
 * The client portal is read-only and single-entity: a business user sees the
 * first entity they've been granted, and only the modules their permissions
 * allow. Same permission engine as the accountant side.
 */

export type PortalContext = {
  user: SessionUser;
  entityId: string;
  entityName: string;
  baseCurrency: string;
  allowed: Set<ModuleKey>;
};

export async function portalContext(): Promise<PortalContext> {
  const user = await requireBusinessUser();

  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      baseCurrency: entities.baseCurrency,
    })
    .from(entities)
    .innerJoin(userEntityAccess, eq(userEntityAccess.entityId, entities.id))
    .where(and(eq(userEntityAccess.userId, user.id), eq(entities.isActive, true), eq(entities.firmId, user.firmId!)))
    .limit(1);

  // /no-access lives outside the portal layout — redirecting to a page that
  // itself calls this function would loop.
  if (!row) redirect("/no-access");

  // A client loses portal access when their accounting firm's subscription
  // lapses — the firm is the paying customer, not the client.
  if (user.firmId) {
    const access = await firmAccessState(user.firmId);
    if (!access.allowed) redirect("/suspended");
  }

  return {
    user,
    entityId: row.id,
    entityName: row.name,
    baseCurrency: row.baseCurrency,
    allowed: await allowedModules(user, row.id),
  };
}

/** Portal page guard: resolves the entity and enforces one module. */
export async function guardPortal(moduleKey: ModuleKey): Promise<PortalContext> {
  const ctx = await portalContext();
  if (!(await hasModule(ctx.user, ctx.entityId, moduleKey))) {
    redirect("/business?denied=" + moduleKey);
  }
  return ctx;
}
