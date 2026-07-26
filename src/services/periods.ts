import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { periods } from "@/db/schema";
import { writeAudit } from "@/services/audit";

/** Create the 12 period rows for a year if missing. Idempotent. */
export async function ensureYearPeriods(entityId: string, year: number) {
  await db
    .insert(periods)
    .values(
      Array.from({ length: 12 }, (_, i) => ({
        entityId,
        year,
        month: i + 1,
      }))
    )
    .onConflictDoNothing();
}

export async function listPeriods(entityId: string, year: number) {
  return db
    .select()
    .from(periods)
    .where(and(eq(periods.entityId, entityId), eq(periods.year, year)))
    .orderBy(asc(periods.month));
}

export async function setPeriodLock(
  entityId: string,
  year: number,
  month: number,
  locked: boolean,
  userId: string
) {
  const [row] = await db
    .update(periods)
    .set({
      isLocked: locked,
      lockedBy: locked ? userId : null,
      lockedAt: locked ? new Date() : null,
    })
    .where(and(eq(periods.entityId, entityId), eq(periods.year, year), eq(periods.month, month)))
    .returning();
  if (!row) throw new Error("Period not found — set up the year first");

  // Spec 14: lock/unlock actions are always logged in the audit trail
  await writeAudit(db, {
    entityId,
    userId,
    action: locked ? "PERIOD_LOCKED" : "PERIOD_UNLOCKED",
    tableName: "periods",
    recordId: row.id,
    afterState: { year, month, isLocked: locked },
  });
  return row;
}
