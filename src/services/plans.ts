import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { plans, subscriptions } from "@/db/schema";
import { writeAudit } from "@/services/audit";

/**
 * Plan catalogue (Phase 9) — platform-owned. A plan is a price plus the caps
 * a subscribing firm gets; `null` on a cap means unlimited.
 */

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export async function listPlans(opts?: { activeOnly?: boolean }) {
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.name));
  return opts?.activeOnly ? rows.filter((p) => p.isActive) : rows;
}

export async function getPlan(planId: string) {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  return plan ?? null;
}

export type PlanInput = {
  code: string;
  name: string;
  description?: string;
  monthlyPrice: string | number;
  currency?: string;
  /** empty string / undefined = unlimited */
  maxEntities?: string | number | null;
  maxUsers?: string | number | null;
  sortOrder?: string | number;
};

function toLimit(v: PlanInput["maxEntities"]): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export async function createPlan(input: PlanInput, actingUserId: string) {
  const code = input.code.trim().toLowerCase().replace(/\s+/g, "-");
  if (!code) throw new PlanError("Plan code is required");
  if (!input.name.trim()) throw new PlanError("Plan name is required");
  if (Number(input.monthlyPrice) < 0) throw new PlanError("Price cannot be negative");

  const [plan] = await db
    .insert(plans)
    .values({
      code,
      name: input.name.trim(),
      description: input.description || null,
      monthlyPrice: String(input.monthlyPrice || 0),
      currency: (input.currency || "USD").toUpperCase(),
      maxEntities: toLimit(input.maxEntities),
      maxUsers: toLimit(input.maxUsers),
      sortOrder: Number(input.sortOrder) || 100,
    })
    .returning();

  await writeAudit(db, {
    userId: actingUserId,
    action: "PLAN_CREATED",
    tableName: "plans",
    recordId: plan.id,
    afterState: { code: plan.code, monthlyPrice: plan.monthlyPrice },
  });
  return plan;
}

export async function updatePlan(planId: string, input: PlanInput, actingUserId: string) {
  const existing = await getPlan(planId);
  if (!existing) throw new PlanError("Plan not found");
  if (!input.name.trim()) throw new PlanError("Plan name is required");

  await db
    .update(plans)
    .set({
      name: input.name.trim(),
      description: input.description || null,
      monthlyPrice: String(input.monthlyPrice || 0),
      currency: (input.currency || "USD").toUpperCase(),
      maxEntities: toLimit(input.maxEntities),
      maxUsers: toLimit(input.maxUsers),
      sortOrder: Number(input.sortOrder) || 100,
    })
    .where(eq(plans.id, planId));

  await writeAudit(db, {
    userId: actingUserId,
    action: "PLAN_UPDATED",
    tableName: "plans",
    recordId: planId,
    beforeState: { name: existing.name, monthlyPrice: existing.monthlyPrice },
    afterState: { name: input.name, monthlyPrice: String(input.monthlyPrice) },
  });
}

export async function setPlanActive(planId: string, isActive: boolean, actingUserId: string) {
  const existing = await getPlan(planId);
  if (!existing) throw new PlanError("Plan not found");

  // Retiring a plan must not orphan the firms already on it.
  if (!isActive) {
    const inUse = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.planId, planId));
    const live = inUse.length;
    if (live > 0) {
      throw new PlanError(
        `${live} subscription${live === 1 ? " is" : "s are"} still on this plan — move them first.`
      );
    }
  }

  await db.update(plans).set({ isActive }).where(eq(plans.id, planId));
  await writeAudit(db, {
    userId: actingUserId,
    action: isActive ? "PLAN_ACTIVATED" : "PLAN_RETIRED",
    tableName: "plans",
    recordId: planId,
  });
}
