import { auditLog } from "@/db/schema";
import type { Db } from "@/db";

export type AuditInput = {
  entityId?: string | null;
  userId?: string | null;
  action: string;
  tableName?: string;
  recordId?: string;
  beforeState?: unknown;
  afterState?: unknown;
  ipAddress?: string;
};

/**
 * Append an audit event. Accepts either the db instance or an open transaction
 * so audit rows commit atomically with the change they describe (spec 15.2).
 */
export async function writeAudit(dbOrTx: Pick<Db, "insert">, input: AuditInput): Promise<void> {
  await dbOrTx.insert(auditLog).values({
    entityId: input.entityId ?? null,
    userId: input.userId ?? null,
    action: input.action,
    tableName: input.tableName,
    recordId: input.recordId,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    ipAddress: input.ipAddress,
  });
}
