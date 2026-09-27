import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, entities, userEntityAccess, firms } from "@/db/schema";
import { hashPassword, type UserRole } from "@/lib/auth";
import { defaultPermissionsFor } from "@/services/permissions";
import { writeAudit } from "@/services/audit";
import { assertCanAddUser } from "@/services/subscriptions";
import { validatePassword } from "@/lib/security";

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
  return db.transaction(async (tx) => {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new UserAdminError("A valid email address is required");
    if (!input.fullName.trim()) throw new UserAdminError("Full name is required");
    validatePassword(input.password);
    if (!ASSIGNABLE_ROLES.some((r) => r.value === input.role)) {
      throw new UserAdminError("Unknown role");
    }

    await tx.execute(sql`SELECT id FROM firms WHERE id = ${input.firmId} FOR UPDATE`);
    await assertCanAddUser(input.firmId, tx);
    const passwordHash = await hashPassword(input.password);
    const [created] = await tx
      .insert(users)
      .values({
        firmId: input.firmId,
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        role: input.role,
      })
      .returning({ id: users.id, email: users.email });

    await writeAudit(tx, {
      userId: actingUserId,
      action: "USER_CREATED",
      tableName: "users",
      recordId: created.id,
      afterState: { email: created.email, role: input.role },
  });

  return created;
  });
}

export async function setUserActive(
  targetUserId: string,
  firmId: string,
  isActive: boolean,
  actingUserId: string
) {
  return db.transaction(async (tx) => {
    if (targetUserId === actingUserId) {
      throw new UserAdminError("You cannot deactivate your own account");
    }
    await tx.execute(sql`SELECT id FROM firms WHERE id = ${firmId} FOR UPDATE`);
    const [target] = await tx
      .select({ id: users.id, email: users.email, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.firmId, firmId)));
    if (!target) throw new UserAdminError("User not found in this firm");

    if (isActive && !target.isActive) await assertCanAddUser(firmId, tx);
    await tx.update(users).set({ isActive }).where(eq(users.id, targetUserId));
    await writeAudit(tx, {
      userId: actingUserId,
      action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      tableName: "users",
      recordId: targetUserId,
      afterState: { email: target.email, isActive },
  });
  });
}

/** Grant access to an entity with role-appropriate starting permissions. */
export async function grantEntityAccess(
  targetUserId: string,
  entityId: string,
  firmId: string,
  actingUserId: string
) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.firmId, firmId)));
    if (!target) throw new UserAdminError("User not found in this firm");

    const [entity] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.firmId, firmId)));
    if (!entity) throw new UserAdminError("Entity not found in this firm");

    await tx
      .insert(userEntityAccess)
      .values({
        userId: targetUserId,
        entityId,
        modulePermissions: defaultPermissionsFor(target.role as UserRole),
      })
      .onConflictDoNothing();

    await writeAudit(tx, {
      entityId,
      userId: actingUserId,
      action: "ENTITY_ACCESS_GRANTED",
      tableName: "user_entity_access",
      recordId: targetUserId,
  });
  });
}

export async function revokeEntityAccess(
  targetUserId: string,
  entityId: string,
  firmId: string,
  actingUserId: string
) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.firmId, firmId)));
    if (!target) throw new UserAdminError("User not found in this firm");

    await tx
      .delete(userEntityAccess)
      .where(
        and(eq(userEntityAccess.userId, targetUserId), eq(userEntityAccess.entityId, entityId))
      );

    await writeAudit(tx, {
      entityId,
      userId: actingUserId,
      action: "ENTITY_ACCESS_REVOKED",
      tableName: "user_entity_access",
      recordId: targetUserId,
  });
  });
}
