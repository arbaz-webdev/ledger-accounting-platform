import "server-only";
import Decimal from "decimal.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db";
import { firms, plans, subscriptions, users, entities } from "@/db/schema";
import { writeAudit } from "@/services/audit";

/**
 * Subscriptions (Phase 9) — what a firm is entitled to.
 *
 * Tenancy (which firm owns what) was already enforced everywhere; this module
 * adds the commercial gate on top: whether that firm may use the product at
 * all, and how much of it.
 *
 * Status semantics:
 *   trial      full access, time-boxed  → warn as the end date approaches
 *   active     paying                   → no restrictions
 *   past_due   payment missed           → still allowed in, warned (grace)
 *   suspended  access revoked           → locked out of every portal
 *   cancelled  historical               → locked out; re-subscribing adds a row
 *
 * A firm with NO subscription row is treated as blocked, which is why the
 * migration backfills every pre-existing firm.
 */

export class SubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionError";
  }
}

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

/** Statuses that still let a firm's users work. */
const USABLE: SubscriptionStatus[] = ["trial", "active", "past_due"];

export type FirmSubscription = {
  id: string;
  firmId: string;
  status: SubscriptionStatus;
  startedOn: string;
  trialEndsOn: string | null;
  currentPeriodEnd: string | null;
  notes: string | null;
  plan: {
    id: string;
    code: string;
    name: string;
    monthlyPrice: string;
    currency: string;
    maxEntities: number | null;
    maxUsers: number | null;
  };
};

/** The firm's live (non-cancelled) subscription, or null. */
export async function getFirmSubscription(firmId: string, executor: Db | Tx = db): Promise<FirmSubscription | null> {
  const [row] = await executor
    .select({
      id: subscriptions.id,
      firmId: subscriptions.firmId,
      status: subscriptions.status,
      startedOn: subscriptions.startedOn,
      trialEndsOn: subscriptions.trialEndsOn,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      notes: subscriptions.notes,
      planId: plans.id,
      planCode: plans.code,
      planName: plans.name,
      monthlyPrice: plans.monthlyPrice,
      currency: plans.currency,
      maxEntities: plans.maxEntities,
      maxUsers: plans.maxUsers,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.firmId, firmId), ne(subscriptions.status, "cancelled")))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    firmId: row.firmId,
    status: row.status as SubscriptionStatus,
    startedOn: row.startedOn,
    trialEndsOn: row.trialEndsOn,
    currentPeriodEnd: row.currentPeriodEnd,
    notes: row.notes,
    plan: {
      id: row.planId,
      code: row.planCode,
      name: row.planName,
      monthlyPrice: row.monthlyPrice,
      currency: row.currency,
      maxEntities: row.maxEntities,
      maxUsers: row.maxUsers,
    },
  };
}

export type FirmAccess = {
  allowed: boolean;
  /** why access was refused, for the /suspended page */
  reason?: string;
  /** non-blocking notice to show in-app (trial ending, payment overdue) */
  warning?: string;
  firmName: string;
  subscription: FirmSubscription | null;
};

/**
 * The gate every firm-scoped portal calls. Deliberately returns a value
 * instead of redirecting so callers can render a banner for soft states.
 */
export async function firmAccessState(firmId: string): Promise<FirmAccess> {
  const [firm] = await db
    .select({ name: firms.name, isActive: firms.isActive })
    .from(firms)
    .where(eq(firms.id, firmId));
  if (!firm) return { allowed: false, reason: "Firm not found", firmName: "", subscription: null };

  const sub = await getFirmSubscription(firmId);

  if (!firm.isActive) {
    return {
      allowed: false,
      reason: "This firm's account has been deactivated by the platform administrator.",
      firmName: firm.name,
      subscription: sub,
    };
  }
  if (!sub) {
    return {
      allowed: false,
      reason: "No active subscription is attached to this firm.",
      firmName: firm.name,
      subscription: null,
    };
  }
  if (!USABLE.includes(sub.status)) {
    return {
      allowed: false,
      reason:
        sub.status === "suspended"
          ? "This firm's subscription is suspended. Contact the platform administrator to restore access."
          : "This firm's subscription has been cancelled.",
      firmName: firm.name,
      subscription: sub,
    };
  }

  // Soft states — allowed, but the user should know
  let warning: string | undefined;
  const today = new Date().toISOString().slice(0, 10);
  if (sub.status === "trial" && (!sub.trialEndsOn || sub.trialEndsOn < today)) {
    return { allowed: false, reason: "The trial period has ended. Contact the platform administrator.", firmName: firm.name, subscription: sub };
  }
  if (sub.status === "past_due") {
    warning = "Payment is overdue. Access continues for now, but please settle the invoice.";
  } else if (sub.status === "trial") {
    warning = sub.trialEndsOn
      ? sub.trialEndsOn < today
        ? "The trial period has ended. Contact the platform administrator to continue."
        : `Trial ends on ${sub.trialEndsOn}.`
      : "This firm is on a trial plan.";
  }

  return { allowed: true, warning, firmName: firm.name, subscription: sub };
}

// ---------------------------------------------------------------------------
// Usage vs plan limits
// ---------------------------------------------------------------------------

export type FirmUsage = {
  entities: number;
  users: number;
  maxEntities: number | null;
  maxUsers: number | null;
  entitiesAtLimit: boolean;
  usersAtLimit: boolean;
};

export async function firmUsage(firmId: string, executor: Db | Tx = db): Promise<FirmUsage> {
  const sub = await getFirmSubscription(firmId, executor);

  const [entityCount] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(entities)
    .where(and(eq(entities.firmId, firmId), eq(entities.isActive, true)));
  const [userCount] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.firmId, firmId), eq(users.isActive, true)));

  const maxEntities = sub?.plan.maxEntities ?? null;
  const maxUsers = sub?.plan.maxUsers ?? null;
  return {
    entities: entityCount?.n ?? 0,
    users: userCount?.n ?? 0,
    maxEntities,
    maxUsers,
    entitiesAtLimit: maxEntities !== null && (entityCount?.n ?? 0) >= maxEntities,
    usersAtLimit: maxUsers !== null && (userCount?.n ?? 0) >= maxUsers,
  };
}

/** Throws if adding another client business would exceed the plan. */
export async function assertCanAddEntity(firmId: string, executor: Db | Tx = db): Promise<void> {
  const usage = await firmUsage(firmId, executor);
  if (usage.entitiesAtLimit) {
    throw new SubscriptionError(
      `Your plan allows ${usage.maxEntities} client${usage.maxEntities === 1 ? "" : "s"} and you have ${usage.entities}. Upgrade the plan to add more.`
    );
  }
}

/** Throws if adding another user would exceed the plan. */
export async function assertCanAddUser(firmId: string, executor: Db | Tx = db): Promise<void> {
  const usage = await firmUsage(firmId, executor);
  if (usage.usersAtLimit) {
    throw new SubscriptionError(
      `Your plan allows ${usage.maxUsers} user${usage.maxUsers === 1 ? "" : "s"} and you have ${usage.users}. Upgrade the plan to add more.`
    );
  }
}

// ---------------------------------------------------------------------------
// Platform-side management
// ---------------------------------------------------------------------------

export type SetSubscriptionInput = {
  firmId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsOn?: string | null;
  currentPeriodEnd?: string | null;
  notes?: string | null;
};

/**
 * Create or replace a firm's live subscription. Cancelling keeps the row as
 * history (the partial unique index only covers non-cancelled rows), so a
 * later re-subscribe inserts a fresh row rather than rewriting the past.
 */
export async function setFirmSubscription(
  input: SetSubscriptionInput,
  actingUserId: string
): Promise<void> {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
    if (!plan) throw new SubscriptionError("Plan not found");

    await tx.execute(sql`SELECT id FROM firms WHERE id = ${input.firmId} FOR UPDATE`);
    const existing = await getFirmSubscription(input.firmId, tx);

    if (!existing) {
      await tx.insert(subscriptions).values({
        firmId: input.firmId,
        planId: input.planId,
        status: input.status,
        startedOn: new Date().toISOString().slice(0, 10),
        trialEndsOn: input.trialEndsOn || null,
        currentPeriodEnd: input.currentPeriodEnd || null,
        notes: input.notes || null,
        createdBy: actingUserId,
      });
    } else if (input.status === "cancelled") {
      await tx
        .update(subscriptions)
        .set({ status: "cancelled", notes: input.notes ?? existing.notes, updatedAt: new Date() })
        .where(eq(subscriptions.id, existing.id));
    } else {
      await tx
        .update(subscriptions)
        .set({
          planId: input.planId,
          status: input.status,
          trialEndsOn: input.trialEndsOn || null,
          currentPeriodEnd: input.currentPeriodEnd || null,
          notes: input.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id));
    }

    await writeAudit(tx, {
      userId: actingUserId,
      action: "SUBSCRIPTION_UPDATED",
      tableName: "subscriptions",
      recordId: input.firmId,
      beforeState: existing
        ? { plan: existing.plan.code, status: existing.status }
        : { plan: null, status: null },
      afterState: { plan: plan.code, status: input.status },
  });
  });
}

export type SubscriptionSummary = {
  totalFirms: number;
  activeFirms: number;
  trialFirms: number;
  pastDueFirms: number;
  suspendedFirms: number;
  /** monthly recurring revenue from paying (active + past_due) firms */
  mrr: string;
  currency: string;
};

export async function platformSummary(): Promise<SubscriptionSummary> {
  const res = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM firms) AS total_firms,
      COUNT(*) FILTER (WHERE s.status = 'active')::int    AS active_firms,
      COUNT(*) FILTER (WHERE s.status = 'trial')::int     AS trial_firms,
      COUNT(*) FILTER (WHERE s.status = 'past_due')::int  AS past_due_firms,
      COUNT(*) FILTER (WHERE s.status = 'suspended')::int AS suspended_firms,
      COALESCE(SUM(p.monthly_price) FILTER (WHERE s.status IN ('active', 'past_due')), 0) AS mrr
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.status <> 'cancelled'
  `);
  const r = res.rows[0] as {
    total_firms: number;
    active_firms: number;
    trial_firms: number;
    past_due_firms: number;
    suspended_firms: number;
    mrr: string;
  };
  return {
    totalFirms: r.total_firms,
    activeFirms: r.active_firms,
    trialFirms: r.trial_firms,
    pastDueFirms: r.past_due_firms,
    suspendedFirms: r.suspended_firms,
    mrr: new Decimal(r.mrr).toFixed(2),
    currency: "USD",
  };
}
