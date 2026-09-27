import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, withTransaction } from "@/db";
import { firms, plans, subscriptions, users, entities } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/security";
import { DEFAULT_COA_TEMPLATE, seedDefaultCoa } from "@/services/coa";
import { ensureYearPeriods } from "@/services/periods";
import { seedDefaultMappings } from "@/services/mappings";
import { assertCanAddEntity } from "@/services/subscriptions";
import { writeAudit } from "@/services/audit";

/**
 * Firms (Phase 9).
 *
 * Two audiences:
 *   • platform_admin — provisions firms, each with an owner login and a
 *     subscription, and can suspend them.
 *   • firm_owner     — manages their own firm: client businesses and team.
 *
 * Provisioning a firm creates three things that must all exist or none:
 * the firm, its owner user, and its subscription — so it runs in one
 * transaction.
 */

export class FirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirmError";
  }
}

// ---------------------------------------------------------------------------
// Platform side
// ---------------------------------------------------------------------------

export type FirmListRow = {
  id: string;
  name: string;
  legalName: string | null;
  contactEmail: string | null;
  isActive: boolean;
  createdAt: Date;
  planName: string | null;
  planCode: string | null;
  status: string | null;
  monthlyPrice: string | null;
  entityCount: number;
  userCount: number;
};

export async function listFirms(): Promise<FirmListRow[]> {
  const res = await db.execute(sql`
    SELECT f.id, f.name, f.legal_name, f.contact_email, f.is_active, f.created_at,
           p.name AS plan_name, p.code AS plan_code, p.monthly_price,
           s.status,
           (SELECT COUNT(*)::int FROM entities e WHERE e.firm_id = f.id AND e.is_active) AS entity_count,
           (SELECT COUNT(*)::int FROM users u WHERE u.firm_id = f.id AND u.is_active) AS user_count
    FROM firms f
    LEFT JOIN subscriptions s ON s.firm_id = f.id AND s.status <> 'cancelled'
    LEFT JOIN plans p ON p.id = s.plan_id
    ORDER BY f.created_at DESC
  `);
  return (
    res.rows as {
      id: string;
      name: string;
      legal_name: string | null;
      contact_email: string | null;
      is_active: boolean;
      created_at: Date;
      plan_name: string | null;
      plan_code: string | null;
      monthly_price: string | null;
      status: string | null;
      entity_count: number;
      user_count: number;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    contactEmail: r.contact_email,
    isActive: r.is_active,
    createdAt: r.created_at,
    planName: r.plan_name,
    planCode: r.plan_code,
    status: r.status,
    monthlyPrice: r.monthly_price,
    entityCount: r.entity_count,
    userCount: r.user_count,
  }));
}

export async function getFirm(firmId: string) {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return null;

  const firmUsers = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.firmId, firmId))
    .orderBy(asc(users.fullName));

  const firmEntities = await db
    .select({
      id: entities.id,
      name: entities.name,
      baseCurrency: entities.baseCurrency,
      isActive: entities.isActive,
    })
    .from(entities)
    .where(eq(entities.firmId, firmId))
    .orderBy(asc(entities.name));

  return { firm, users: firmUsers, entities: firmEntities };
}

export type ProvisionFirmInput = {
  name: string;
  legalName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** owner login created alongside the firm */
  ownerFullName: string;
  ownerEmail: string;
  ownerPassword: string;
  planId: string;
  status?: "trial" | "active";
  trialDays?: number;
};

/** Create firm + owner login + subscription in one transaction. */
export async function provisionFirm(input: ProvisionFirmInput, actingUserId: string) {
  if (!input.name.trim()) throw new FirmError("Firm name is required");
  if (!input.ownerFullName.trim()) throw new FirmError("Owner name is required");
  const email = input.ownerEmail.trim().toLowerCase();
  if (!email.includes("@")) throw new FirmError("A valid owner email is required");
  validatePassword(input.ownerPassword);

  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId));
  if (!plan) throw new FirmError("Plan not found");

  const passwordHash = await hashPassword(input.ownerPassword);
  const status = input.status ?? "trial";
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const trialEnd = new Date(today);
  trialEnd.setDate(trialEnd.getDate() + (input.trialDays ?? 14));
  const periodEnd = new Date(today);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  return withTransaction(async (tx) => {
    const [firm] = await tx
      .insert(firms)
      .values({
        name: input.name.trim(),
        legalName: input.legalName || null,
        contactEmail: input.contactEmail || email,
        contactPhone: input.contactPhone || null,
      })
      .returning();

    const [owner] = await tx
      .insert(users)
      .values({
        firmId: firm.id,
        email,
        passwordHash,
        fullName: input.ownerFullName.trim(),
        role: "firm_owner",
      })
      .returning({ id: users.id, email: users.email });

    await tx.insert(subscriptions).values({
      firmId: firm.id,
      planId: plan.id,
      status,
      startedOn: iso(today),
      trialEndsOn: status === "trial" ? iso(trialEnd) : null,
      currentPeriodEnd: iso(periodEnd),
      createdBy: actingUserId,
    });

    await writeAudit(tx, {
      userId: actingUserId,
      action: "FIRM_PROVISIONED",
      tableName: "firms",
      recordId: firm.id,
      afterState: { name: firm.name, owner: owner.email, plan: plan.code, status },
    });

    return { firmId: firm.id, ownerId: owner.id };
  });
}

export async function setFirmActive(firmId: string, isActive: boolean, actingUserId: string) {
  return db.transaction(async (tx) => {
    const [firm] = await tx.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId));
    if (!firm) throw new FirmError("Firm not found");

    await tx.update(firms).set({ isActive }).where(eq(firms.id, firmId));
    await writeAudit(tx, {
      userId: actingUserId,
      action: isActive ? "FIRM_REACTIVATED" : "FIRM_DEACTIVATED",
      tableName: "firms",
      recordId: firmId,
      afterState: { name: firm.name, isActive },
  });
  });
}

// ---------------------------------------------------------------------------
// Firm side (firm_owner managing their own practice)
// ---------------------------------------------------------------------------

export type FirmSettingsInput = {
  name: string;
  legalName?: string;
  contactEmail?: string;
  contactPhone?: string;
};

export async function updateFirmSettings(
  firmId: string,
  input: FirmSettingsInput,
  actingUserId: string
) {
  return db.transaction(async (tx) => {
    if (!input.name.trim()) throw new FirmError("Firm name is required");
    await tx
      .update(firms)
      .set({
        name: input.name.trim(),
        legalName: input.legalName || null,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
      })
      .where(eq(firms.id, firmId));

    await writeAudit(tx, {
      userId: actingUserId,
      action: "FIRM_SETTINGS_UPDATED",
      tableName: "firms",
      recordId: firmId,
      afterState: { name: input.name },
  });
  });
}

export type CreateClientInput = {
  name: string;
  legalName?: string;
  baseCurrency?: string;
  fiscalYearStartMonth?: string | number;
};

/**
 * Create a client business for the firm: entity + default chart of accounts +
 * current-year periods + account mappings, so it's immediately usable.
 * Plan limits are checked first.
 */
export async function createClient(
  firmId: string,
  input: CreateClientInput,
  actingUserId: string
) {
  return db.transaction(async (tx) => {
    if (!input.name.trim()) throw new FirmError("Client name is required");
    await tx.execute(sql`SELECT id FROM firms WHERE id = ${firmId} FOR UPDATE`);
    await assertCanAddEntity(firmId, tx);

    const currency = (input.baseCurrency || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new FirmError("Currency must be a 3-letter code");
    const fyMonth = Number(input.fiscalYearStartMonth) || 1;
    if (fyMonth < 1 || fyMonth > 12) throw new FirmError("Fiscal year start month must be 1–12");

    const [entity] = await tx
      .insert(entities)
      .values({
        firmId,
        name: input.name.trim(),
        legalName: input.legalName || null,
        baseCurrency: currency,
        fiscalYearStartMonth: fyMonth,
      })
      .returning({ id: entities.id });

    // Make the client immediately usable: default chart of accounts, this
    // year's periods, and the account mappings every posting module resolves
    // through. Each step is idempotent, so a retry can't duplicate anything.
    await seedDefaultCoa(entity.id, tx);
    await ensureYearPeriods(entity.id, new Date().getFullYear(), tx);
    await seedDefaultMappings(entity.id, tx);

    await writeAudit(tx, {
      entityId: entity.id,
      userId: actingUserId,
      action: "CLIENT_CREATED",
      tableName: "entities",
      recordId: entity.id,
      afterState: { name: input.name.trim(), baseCurrency: currency, accounts: DEFAULT_COA_TEMPLATE.length },
  });

  return entity.id;
  });
}

export async function listFirmClients(firmId: string) {
  const res = await db.execute(sql`
    SELECT e.id, e.name, e.legal_name, e.base_currency, e.is_active, e.created_at,
           (SELECT COUNT(*)::int FROM journal_entries je
             WHERE je.entity_id = e.id AND je.status = 'posted') AS posted_entries,
           (SELECT COUNT(*)::int FROM user_entity_access uea
             WHERE uea.entity_id = e.id) AS assigned_users
    FROM entities e
    WHERE e.firm_id = ${firmId}
    ORDER BY e.name
  `);
  return (
    res.rows as {
      id: string;
      name: string;
      legal_name: string | null;
      base_currency: string;
      is_active: boolean;
      created_at: Date;
      posted_entries: number;
      assigned_users: number;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    baseCurrency: r.base_currency,
    isActive: r.is_active,
    createdAt: r.created_at,
    postedEntries: r.posted_entries,
    assignedUsers: r.assigned_users,
  }));
}

export async function setClientActive(
  entityId: string,
  firmId: string,
  isActive: boolean,
  actingUserId: string
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM firms WHERE id = ${firmId} FOR UPDATE`);
    const [entity] = await tx
      .select({ name: entities.name, isActive: entities.isActive })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.firmId, firmId)));
    if (!entity) throw new FirmError("Client not found in this firm");

    if (isActive && !entity.isActive) await assertCanAddEntity(firmId, tx);

    await tx.update(entities).set({ isActive }).where(eq(entities.id, entityId));
    await writeAudit(tx, {
      entityId,
      userId: actingUserId,
      action: isActive ? "CLIENT_REACTIVATED" : "CLIENT_ARCHIVED",
      tableName: "entities",
      recordId: entityId,
      afterState: { name: entity.name, isActive },
  });
  });
}

/** Firm dashboard counters. */
export async function firmOverview(firmId: string) {
  const res = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM entities WHERE firm_id = ${firmId} AND is_active) AS active_clients,
      (SELECT COUNT(*)::int FROM entities WHERE firm_id = ${firmId}) AS total_clients,
      (SELECT COUNT(*)::int FROM users WHERE firm_id = ${firmId} AND is_active) AS active_users,
      (SELECT COUNT(*)::int FROM journal_entries je
         JOIN entities e ON e.id = je.entity_id
        WHERE e.firm_id = ${firmId} AND je.status = 'posted') AS posted_entries
  `);
  return res.rows[0] as {
    active_clients: number;
    total_clients: number;
    active_users: number;
    posted_entries: number;
  };
}
