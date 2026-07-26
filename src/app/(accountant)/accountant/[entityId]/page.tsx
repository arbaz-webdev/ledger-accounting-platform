import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chartOfAccounts, journalEntries } from "@/db/schema";
import { getTrialBalance } from "@/services/reports";
import { getProfitAndLoss, defaultFiscalRange } from "@/services/statements";
import { entities } from "@/db/schema";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, StatCard, StatusBadge, Amount, EmptyState } from "@/components/ui";
import { IconJournal, IconPlus } from "@/components/icons";

export default async function EntityOverview({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const today = todayIso();

  const [entity] = await db
    .select({ fy: entities.fiscalYearStartMonth })
    .from(entities)
    .where(eq(entities.id, entityId));
  const range = defaultFiscalRange(today, entity?.fy ?? 1);

  const [[accountCount], [draftCount], tb, pl, recent] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.entityId, entityId), eq(chartOfAccounts.isActive, true))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(and(eq(journalEntries.entityId, entityId), eq(journalEntries.status, "draft"))),
    getTrialBalance(entityId, today),
    getProfitAndLoss(entityId, range.from, today),
    db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.entityId, entityId))
      .orderBy(desc(journalEntries.createdAt))
      .limit(6),
  ]);

  return (
    <div className="fade-up">
      <PageHeader title="Overview" sub={`Fiscal year to date · ${range.from} — ${today}`}>
        <a href={`/accountant/${entityId}/journal/new`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New journal entry
        </a>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Net revenue (FYTD)"
          value={<Amount value={pl.revenue.net} />}
          accent="brand"
        />
        <StatCard label="Net profit (FYTD)" value={<Amount value={pl.netProfit} />} />
        <StatCard
          label="Trial balance"
          value={tb.balanced ? "Balanced" : "Out of balance"}
          hint={tb.balanced ? `Dr = Cr = ${fmtMoney(tb.totalDebits)}` : "Investigate immediately"}
          accent={tb.balanced ? "brand" : "negative"}
        />
        <StatCard
          label="Open items"
          value={String(draftCount.n)}
          hint={`draft entries · ${accountCount.n} active accounts`}
        />
      </div>

      <div className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--ink-100)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">Recent journal activity</h2>
          <a
            href={`/accountant/${entityId}/journal`}
            className="text-[0.8125rem] font-medium text-[var(--brand-700)] hover:underline"
          >
            View all
          </a>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon={<IconJournal className="h-5 w-5" />}
            title="No journal entries yet"
            hint="Post your first entry to see activity here."
            action={
              <a href={`/accountant/${entityId}/journal/new`} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                New entry
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>JE #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Source</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((je) => (
                <tr key={je.id} className="tbl-row-link">
                  <td className="acct">
                    <a
                      href={`/accountant/${entityId}/journal/${je.id}`}
                      className="hover:text-[var(--brand-700)] hover:underline"
                    >
                      {je.jeNumber ?? "—"}
                    </a>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(je.date)}</td>
                  <td className="max-w-[320px] truncate">{je.description}</td>
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
