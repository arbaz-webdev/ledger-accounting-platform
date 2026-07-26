import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users, entities, userEntityAccess } from "@/db/schema";
import { hashPassword, type UserRole } from "@/lib/auth";
import { defaultPermissionsFor } from "@/services/permissions";
import { writeAudit } from "@/services/audit";

/**
 * Firm user administration (Phase 8). Scoped to the acting user's firm —
 * a firm admin can only ever see or touch users of their own firm.
 */

export class UserAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAdminError";
  }
}

import { ASSIGNABLE_ROLES } from "@/lib/roles";
export { ASSIGNABLE_ROLES };

export type FirmUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  entityIds: string[];
};

export async function listFirmUsers(firmId: string): Promise<FirmUser[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.firmId, firmId))
    .orderBy(users.fullName);
  if (rows.length === 0) return [];

  const access = await db
    .select({ userId: userEntityAccess.userId, entityId: userEntityAccess.entityId })
    .from(userEntityAccess)
    .where(
      inArray(
        userEntityAccess.userId,
        rows.map((r) => r.id)
      )
    );

  return rows.map((r) => ({
    ...r,
    role: r.role as UserRole,
    entityIds: access.filter((a) => a.userId === r.id).map((a) => a.entityId),
  }));
}

export async function getFirmUser(userId: string, firmId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)));
  if (!user) return null;

  const access = await db
    .select({
      entityId: userEntityAccess.entityId,
      entityName: entities.name,
      permissions: userEntityAccess.modulePermissions,
    })
    .from(userEntityAccess)
    .innerJoin(entities, eq(entities.id, userEntityAccess.entityId))
    .where(eq(userEntityAccess.userId, userId));

  return { user: { ...user, role: user.role as UserRole }, access };
}

export type CreateUserInput = {
  firmId: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** initial password — the user should change it on first sign-in */
  password: string;
};

export async function createFirmUser(input: CreateUserInput, actingUserId: string) {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new UserAdminError("A valid email address is required");
  if (!input.fullName.trim()) throw new UserAdminError("Full name is required");
  if (input.password.length < 8) {
    throw new UserAdminError("The initial password must be at least 8 characters");
  }
  if (!ASSIGNABLE_ROLES.some((r) => r.value === input.role)) {
    throw new UserAdminError("Unknown role");
  }

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      firmId: input.firmId,
      email,
      passwordHash,
      fullName: input.fullName.trim(),
      role: input.role,
    })
    .returning({ id: users.id, email: users.email });

  await writeAudit(db, {
    userId: actingUserId,
    action: "USER_CREATED",
    tableName: "users",
    recordId: created.id,
    afterState: { email: created.email, role: input.role },
  });

  return created;
}

export async function setUserActive(
  targetUserId: string,
  firmId: string,
  isActive: boolean,
  actingUserId: string
) {
  if (targetUserId === actingUserId) {
    throw new UserAdminError("You cannot deactivate your own account");
  }
  const [target] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.firmId, firmId)));
  if (!target) throw new UserAdminError("User not found in this firm");

  await db.update(users).set({ isActive }).where(eq(users.id, targetUserId));
  await writeAudit(db, {
    userId: actingUserId,
    action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    tableName: "users",
    recordId: targetUserId,
    afterState: { email: target.email, isActive },
  });
}

/** Grant access to an entity with role-appropriate starting permissions. */
export async function grantEntityAccess(
  targetUserId: string,
  entityId: string,
  firmId: string,
  actingUserId: string
) {
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.firmId, firmId)));
  if (!target) throw new UserAdminError("User not found in this firm");

  const [entity] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.firmId, firmId)));
  if (!entity) throw new UserAdminError("Entity not found in this firm");

  await db
    .insert(userEntityAccess)
    .values({
      userId: targetUserId,
      entityId,
      modulePermissions: defaultPermissionsFor(target.role as UserRole),
    })
    .onConflictDoNothing();

  await writeAudit(db, {
    entityId,
    userId: actingUserId,
    action: "ENTITY_ACCESS_GRANTED",
    tableName: "user_entity_access",
    recordId: targetUserId,
  });
}

export async function revokeEntityAccess(
  targetUserId: string,
  entityId: string,
  firmId: string,
  actingUserId: string
) {
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.firmId, firmId)));
  if (!target) throw new UserAdminError("User not found in this firm");

  await db
    .delete(userEntityAccess)
    .where(
      and(eq(userEntityAccess.userId, targetUserId), eq(userEntityAccess.entityId, entityId))
    );

  await writeAudit(db, {
    entityId,
    userId: actingUserId,
    action: "ENTITY_ACCESS_REVOKED",
    tableName: "user_entity_access",
    recordId: targetUserId,
  });
}
