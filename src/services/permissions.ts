import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { userEntityAccess } from "@/db/schema";
import { writeAudit } from "@/services/audit";
import type { SessionUser, UserRole } from "@/lib/auth";

/**
 * Per-entity module permissions (spec 15 permissions matrix).
 *
 * `user_entity_access.module_permissions` has existed since Phase 0 but was
 * never enforced — this module makes it real. Two layers, both required:
 *
 *   1. ROLE  — coarse capability that no per-entity grant can exceed. A
 *              view_only user can never post, whatever the matrix says.
 *   2. MATRIX — per user, per entity, per module on/off.
 *
 * firm_admin / platform_admin bypass the matrix for their own firm's entities
 * (they administer it), so an admin can never lock themselves out.
 */

export const MODULES = [
  "coa",
  "journal",
  "sales",
  "purchases",
  "banking",
  "payroll",
  "inventory",
  "reports",
  "periods",
  "admin",
] as const;

export type ModuleKey = (typeof MODULES)[number];

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  hint: string;
  /** roles that may hold this permission at all */
  allowedRoles: UserRole[];
};

const ALL_ACCOUNTANT: UserRole[] = ["platform_admin", "firm_admin", "accountant_staff"];
const ACCOUNTANT_AND_BUSINESS: UserRole[] = [
  ...ALL_ACCOUNTANT,
  "business_admin",
  "business_staff",
  "view_only",
];

export const MODULE_DEFS: ModuleDef[] = [
  {
    key: "coa",
    label: "Chart of accounts",
    hint: "View and maintain the account structure.",
    allowedRoles: ALL_ACCOUNTANT,
  },
  {
    key: "journal",
    label: "Journal entries",
    hint: "Post, draft and void manual journal entries.",
    allowedRoles: ALL_ACCOUNTANT,
  },
  {
    key: "sales",
    label: "Invoicing (AR)",
    hint: "Customer invoices, receipts and credit notes.",
    allowedRoles: ACCOUNTANT_AND_BUSINESS,
  },
  {
    key: "purchases",
    label: "Bills (AP)",
    hint: "Supplier bills, payments and supplier credits.",
    allowedRoles: ACCOUNTANT_AND_BUSINESS,
  },
  {
    key: "banking",
    label: "Banking",
    hint: "Bank import, review queue, rules and reconciliation.",
    allowedRoles: ALL_ACCOUNTANT,
  },
  {
    key: "payroll",
    label: "Payroll",
    hint: "Employees and pay runs — often restricted to senior staff.",
    allowedRoles: ALL_ACCOUNTANT,
  },
  {
    key: "inventory",
    label: "Inventory",
    hint: "Items, stock movements and valuation.",
    allowedRoles: ALL_ACCOUNTANT,
  },
  {
    key: "reports",
    label: "Reports & statements",
    hint: "Trial balance, P&L, balance sheet and management reports.",
    allowedRoles: ACCOUNTANT_AND_BUSINESS,
  },
  {
    key: "periods",
    label: "Periods & close",
    hint: "Lock periods and run the year-end close.",
    allowedRoles: ["platform_admin", "firm_admin"],
  },
  {
    key: "admin",
    label: "Administration",
    hint: "Account mappings, FX rates, users and the audit trail.",
    allowedRoles: ["platform_admin", "firm_admin"],
  },
];

export const MODULE_LABEL: Record<ModuleKey, string> = Object.fromEntries(
  MODULE_DEFS.map((d) => [d.key, d.label])
) as Record<ModuleKey, string>;

export class PermissionError extends Error {
  /** the module that was denied, so the UI can explain it */
  readonly moduleKey: ModuleKey;
  constructor(moduleKey: ModuleKey, message: string) {
    super(message);
    this.name = "PermissionError";
    this.moduleKey = moduleKey;
  }
}

/** Admins administer the matrix, so it never applies to them. */
function bypassesMatrix(role: UserRole): boolean {
  return role === "platform_admin" || role === "firm_admin";
}

export function roleAllows(role: UserRole, moduleKey: ModuleKey): boolean {
  const def = MODULE_DEFS.find((d) => d.key === moduleKey);
  return def ? def.allowedRoles.includes(role) : false;
}

/** Sensible starting grants when a user is first given access to an entity. */
export function defaultPermissionsFor(role: UserRole): Record<string, boolean> {
  const granted: Record<string, boolean> = {};
  for (const def of MODULE_DEFS) {
    if (!def.allowedRoles.includes(role)) continue;
    if (role === "view_only") {
      granted[def.key] = def.key === "reports";
    } else if (role === "accountant_staff") {
      // everything except the two admin-only modules (already filtered out)
      granted[def.key] = true;
    } else if (role === "business_admin" || role === "business_staff") {
      granted[def.key] = true;
    } else {
      granted[def.key] = true;
    }
  }
  return granted;
}

export type EntityPermissions = Record<string, boolean>;

export async function getEntityPermissions(
  userId: string,
  entityId: string
): Promise<EntityPermissions> {
  const [row] = await db
    .select({ perms: userEntityAccess.modulePermissions })
    .from(userEntityAccess)
    .where(and(eq(userEntityAccess.userId, userId), eq(userEntityAccess.entityId, entityId)));
  return (row?.perms as EntityPermissions) ?? {};
}

/**
 * Effective permission for one module: role gate first, then the matrix
 * (which admins bypass).
 */
export async function hasModule(
  user: SessionUser,
  entityId: string,
  moduleKey: ModuleKey
): Promise<boolean> {
  if (!roleAllows(user.role, moduleKey)) return false;
  if (bypassesMatrix(user.role)) return true;
  const perms = await getEntityPermissions(user.id, entityId);
  return perms[moduleKey] === true;
}

/** All modules this user can use in this entity — drives nav rendering. */
export async function allowedModules(
  user: SessionUser,
  entityId: string
): Promise<Set<ModuleKey>> {
  const allowed = new Set<ModuleKey>();
  const bypass = bypassesMatrix(user.role);
  const perms = bypass ? null : await getEntityPermissions(user.id, entityId);
  for (const def of MODULE_DEFS) {
    if (!def.allowedRoles.includes(user.role)) continue;
    if (bypass || perms?.[def.key] === true) allowed.add(def.key);
  }
  return allowed;
}

/** Guard for server actions and route segments. Throws PermissionError. */
export async function requireModule(
  user: SessionUser,
  entityId: string,
  moduleKey: ModuleKey
): Promise<void> {
  if (await hasModule(user, entityId, moduleKey)) return;
  const def = MODULE_DEFS.find((d) => d.key === moduleKey);
  throw new PermissionError(
    moduleKey,
    `Your account does not have access to ${def?.label ?? moduleKey} for this client.`
  );
}

export async function setEntityPermissions(
  targetUserId: string,
  entityId: string,
  permissions: EntityPermissions,
  actingUserId: string
): Promise<void> {
  const [existing] = await db
    .select({ perms: userEntityAccess.modulePermissions })
    .from(userEntityAccess)
    .where(and(eq(userEntityAccess.userId, targetUserId), eq(userEntityAccess.entityId, entityId)));
  if (!existing) throw new Error("That user has no access to this entity yet");

  await db
    .update(userEntityAccess)
    .set({ modulePermissions: permissions })
    .where(and(eq(userEntityAccess.userId, targetUserId), eq(userEntityAccess.entityId, entityId)));

  await writeAudit(db, {
    entityId,
    userId: actingUserId,
    action: "PERMISSIONS_UPDATED",
    tableName: "user_entity_access",
    recordId: targetUserId,
    beforeState: existing.perms,
    afterState: permissions,
  });
}
