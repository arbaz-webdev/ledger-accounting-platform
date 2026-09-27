import "server-only";
import { and, asc, desc, eq, sql, inArray } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db";
import { periods, entities, auditLog, users } from "@/db/schema";
import { writeAudit } from "@/services/audit";
import { assertSuspenseClear } from "@/services/account-policy";

/** Create the 12 period rows for a year if missing. Idempotent. */
export async function ensureYearPeriods(entityId: string, year: number, executor: Db | Tx = db) {
  await executor
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

export async function listPeriodHistory(entityId: string) {
  return db.select({ id: auditLog.id, action: auditLog.action, date: auditLog.createdAt, details: auditLog.afterState, actor: users.fullName })
    .from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.entityId, entityId), inArray(auditLog.action, ["PERIOD_LOCKED", "PERIOD_UNLOCKED", "FY_CLOSED", "FY_REOPENED"])))
    .orderBy(desc(auditLog.createdAt)).limit(50);
}

export async function setPeriodLock(
  entityId: string,
  year: number,
  month: number,
  locked: boolean,
  userId: string,
  callerTx?: Tx,
  reason = ""
) {
  const run = async (tx: Tx) => {
    await tx.select({ id: entities.id }).from(entities).where(eq(entities.id, entityId)).for("update");
    if (!Number.isInteger(year) || year < 1900 || year > 9998 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid period");
    if (!locked && reason.trim().length < 5) throw new Error("Enter an unlock reason of at least five characters");
    if (locked) {
      const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      await assertSuspenseClear(entityId, end, tx);
    } else if (!callerTx) {
      const closed = await tx.execute(sql`SELECT 1 FROM fiscal_year_closes WHERE entity_id=${entityId} AND reopened_at IS NULL
        AND make_date(${year},${month},1) BETWEEN start_date AND end_date LIMIT 1`);
      if (closed.rows.length) throw new Error("Reopen the fiscal year before unlocking one of its periods");
    }
    const [row] = await tx
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
    await writeAudit(tx, {
      entityId,
      userId,
      action: locked ? "PERIOD_LOCKED" : "PERIOD_UNLOCKED",
      tableName: "periods",
      recordId: row.id,
      afterState: { year, month, isLocked: locked, reason: reason.trim() },
  });
  return row;
  };
  return callerTx ? run(callerTx) : db.transaction(run);
}
