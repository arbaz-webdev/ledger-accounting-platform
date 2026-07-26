import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";
import { IconJournal, IconPlus } from "@/components/icons";

export default async function JournalListPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const entries = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.entityId, entityId))
    .orderBy(desc(journalEntries.createdAt))
    .limit(200);

  return (
    <div className="fade-up">
      <PageHeader
        title="Journal"
        sub="Every financial event, as balanced double-entry records."
      >
        <a href={`/accountant/${entityId}/journal/new`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New journal entry
        </a>
      </PageHeader>

      <div className="card overflow-x-auto">
        {entries.length === 0 ? (
          <EmptyState
            icon={<IconJournal className="h-5 w-5" />}
            title="No journal entries yet"
            hint="Post your first entry — invoices, bills and payroll will land here automatically in later phases."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>JE #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th>Source</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((je) => (
                <tr key={je.id} className="tbl-row-link">
                  <td className="acct">
                    <a
                      href={`/accountant/${entityId}/journal/${je.id}`}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {je.jeNumber ?? "—"}
                    </a>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(je.date)}</td>
                  <td className="max-w-[300px] truncate font-medium text-[var(--ink-800)]">
                    <a
                      href={`/accountant/${entityId}/journal/${je.id}`}
                      className="hover:text-[var(--brand-700)]"
                    >
                      {je.description}
                    </a>
                  </td>
                  <td className="acct">{je.reference ?? ""}</td>
                  <td className="text-xs uppercase tracking-wide text-[var(--ink-400)]">
                    {je.sourceModule}
                  </td>
                  <td className="text-right">
                    <StatusBadge status={je.status} />
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
