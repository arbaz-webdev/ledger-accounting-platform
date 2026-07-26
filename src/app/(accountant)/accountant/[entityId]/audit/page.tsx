import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconShield } from "@/components/icons";

const ACTION_STYLES: Record<string, string> = {
  JE_POSTED: "badge-posted",
  JE_VOIDED: "badge-voided",
  JE_DRAFT_SAVED: "badge-draft",
  JE_DRAFT_DISCARDED: "badge-draft",
  PERIOD_LOCKED: "badge-locked",
  PERIOD_UNLOCKED: "badge-open",
  COA_CREATED: "badge-info",
  COA_UPDATED: "badge-info",
};

export default async function AuditTrailPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      tableName: auditLog.tableName,
      recordId: auditLog.recordId,
      afterState: auditLog.afterState,
      createdAt: auditLog.createdAt,
      userName: users.fullName,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(eq(auditLog.entityId, entityId))
    .orderBy(desc(auditLog.id))
    .limit(200);

  return (
    <div className="fade-up">
      <PageHeader
        title="Audit Trail"
        sub="Append-only log — records can never be modified or deleted, even by admins."
      />

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconShield className="h-5 w-5" />}
            title="No audit events yet"
            hint="Every posting, void, period lock and account change is recorded here."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>User</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="tbl-row-link align-top">
                  <td className="acct whitespace-nowrap">
                    {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="whitespace-nowrap font-medium text-[var(--ink-800)]">
                    {r.userName ?? "System"}
                  </td>
                  <td>
                    <span className={`badge ${ACTION_STYLES[r.action] ?? "badge-neutral"}`}>
                      {r.action.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="acct max-w-md truncate">
                    {r.afterState ? JSON.stringify(r.afterState).slice(0, 140) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
