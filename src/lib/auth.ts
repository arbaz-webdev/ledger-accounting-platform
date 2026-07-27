import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, entities, userEntityAccess } from "@/db/schema";

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export type UserRole =
  | "platform_admin"
  | "firm_owner"
  | "firm_admin"
  | "accountant_staff"
  | "business_admin"
  | "business_staff"
  | "view_only";

/**
 * Four tiers, each with its own portal (spec: Phase 9).
 *   platform_admin              /platform    the software vendor
 *   firm_owner                  /firm        the subscribing accounting firm
 *   firm_admin, accountant_staff /accountant staff who keep the books
 *   business roles, view_only   /business    the firm's clients, read-only
 *
 * firm_owner also appears in ACCOUNTANT_ROLES: they own the practice, so they
 * may work in the books too — but their HOME is /firm.
 */
export const ACCOUNTANT_ROLES: UserRole[] = [
  "platform_admin",
  "firm_owner",
  "firm_admin",
  "accountant_staff",
];
export const BUSINESS_ROLES: UserRole[] = ["business_admin", "business_staff", "view_only"];

/** Where a role lands after signing in. */
export function homePathFor(role: UserRole): string {
  if (role === "platform_admin") return "/platform";
  if (role === "firm_owner") return "/firm";
  if (ACCOUNTANT_ROLES.includes(role)) return "/accountant";
  return "/business";
}

export type SessionUser = {
  id: string;
  firmId: string | null;
  email: string;
  fullName: string;
  role: UserRole;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ token, userId, expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
    cookieStore.delete(SESSION_COOKIE);
  }
}

/** Current user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      firmId: users.firmId,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));

  const row = rows[0];
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    firmId: row.firmId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as UserRole,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAccountant(): Promise<SessionUser> {
  const user = await requireUser();
  if (!ACCOUNTANT_ROLES.includes(user.role)) redirect(homePathFor(user.role));
  return user;
}

export async function requireBusinessUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!BUSINESS_ROLES.includes(user.role)) redirect(homePathFor(user.role));
  return user;
}

/** Tier 1: the software vendor. Not scoped to any firm. */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "platform_admin") redirect(homePathFor(user.role));
  return user;
}

/**
 * Tier 2: the firm that bought the subscription. Guarantees a firmId, so
 * callers never have to null-check the tenant they're operating on.
 */
export async function requireFirmOwner(): Promise<SessionUser & { firmId: string }> {
  const user = await requireUser();
  if (user.role !== "firm_owner") redirect(homePathFor(user.role));
  if (!user.firmId) redirect("/no-access");
  return user as SessionUser & { firmId: string };
}

/**
 * Tenancy guard: throws unless the user can access the given entity.
 * firm_admin / platform_admin -> any entity of their firm (or all, for platform).
 * Everyone else needs an explicit user_entity_access row.
 */
export async function assertEntityAccess(user: SessionUser, entityId: string): Promise<void> {
  const entityRows = await db
    .select({ id: entities.id, firmId: entities.firmId })
    .from(entities)
    .where(eq(entities.id, entityId));
  const entity = entityRows[0];
  if (!entity) throw new Error("Entity not found");

  // Platform admins reach any firm's books for support (audit-logged by the
  // support-access route, not here).
  if (user.role === "platform_admin") return;
  // Whoever runs the firm reaches every client of that firm.
  if ((user.role === "firm_admin" || user.role === "firm_owner") && entity.firmId === user.firmId) {
    return;
  }

  const access = await db
    .select({ userId: userEntityAccess.userId })
    .from(userEntityAccess)
    .where(and(eq(userEntityAccess.userId, user.id), eq(userEntityAccess.entityId, entityId)));
  if (access.length === 0) throw new Error("Access denied to this entity");

  // staff/business roles also must not cross firms
  if (entity.firmId !== user.firmId) throw new Error("Access denied to this entity");
}
