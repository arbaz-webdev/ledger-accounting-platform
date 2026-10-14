import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { portalContext } from "@/lib/business-guard";
import { PageHeader } from "@/components/ui";

export default async function BusinessActivityPage() {
  const ctx = await portalContext();
  if (ctx.user.role !== "business_admin") redirect("/business?denied=activity");
  const rows = await db.select({id:auditLog.id,createdAt:auditLog.createdAt,action:auditLog.action,
    tableName:auditLog.tableName,recordId:auditLog.recordId,userName:users.fullName})
    .from(auditLog).leftJoin(users,eq(auditLog.userId,users.id))
    .where(eq(auditLog.entityId,ctx.entityId)).orderBy(desc(auditLog.id)).limit(200);
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Activity log" sub="Recent posting and settings changes in this business. Entries cannot be edited or deleted." />
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>When (UTC)</th><th>User</th><th>Action</th><th>Record</th></tr></thead><tbody>
      {rows.map(row=><tr key={row.id}><td className="whitespace-nowrap">{row.createdAt.toISOString().replace("T"," ").slice(0,19)}</td>
        <td>{row.userName??"System"}</td><td>{row.action.replaceAll("_"," ")}</td>
        <td>{row.tableName??"—"}{row.recordId?` · ${row.recordId}`:""}</td></tr>)}
    </tbody></table>{!rows.length&&<p className="p-4 text-sm text-[var(--ink-500)]">No activity has been recorded yet.</p>}</div>
  </main>;
}
