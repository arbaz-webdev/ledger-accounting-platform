import { listPeriods } from "@/services/periods";
import { togglePeriodLockAction, setupYearAction } from "./actions";
import { fmtDate, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { IconLock, IconUnlock, IconCalendar } from "@/components/icons";
import { EmptyState } from "@/components/ui";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PeriodsPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const year = Number(sp.year) || Number(todayIso().slice(0, 4));
  const rows = await listPeriods(entityId, year);
  const lockedCount = rows.filter((p) => p.isLocked).length;

  return (
    <div className="fade-up">
      <PageHeader
        title={`Periods · ${year}`}
        sub="Locked periods reject all postings — enforced by the database, not just the UI."
      >
        <div className="flex items-center gap-2">
          <a href={`/accountant/${entityId}/periods?year=${year - 1}`} className="btn btn-secondary btn-sm">
            ← {year - 1}
          </a>
          <a href={`/accountant/${entityId}/periods?year=${year + 1}`} className="btn btn-secondary btn-sm">
            {year + 1} →
          </a>
          <a href={`/accountant/${entityId}/periods/year-end?year=${year}`} className="btn btn-primary btn-sm">
            Year-end close
          </a>
        </div>
      </PageHeader>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconCalendar className="h-5 w-5" />}
            title={`${year} has not been set up yet`}
            hint="Create the twelve monthly periods to start posting in this year."
            action={
              <form action={setupYearAction}>
                <input type="hidden" name="entityId" value={entityId} />
                <input type="hidden" name="year" value={year} />
                <button className="btn btn-primary">Set up {year} periods</button>
              </form>
            }
          />
        </div>
      ) : (
        <>
          <p className="mb-3 text-[0.8125rem] text-[var(--ink-500)]">
            {lockedCount} of {rows.length} months locked
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((p) => (
              <div
                key={p.id}
                className={`card p-4 transition-colors duration-150 ${
                  p.isLocked ? "bg-[var(--ink-50)]" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--ink-900)]">
                    {MONTHS[p.month - 1]}
                  </span>
                  <span className={`badge ${p.isLocked ? "badge-locked" : "badge-open"}`}>
                    {p.isLocked ? <IconLock className="h-3 w-3" /> : <span className="badge-dot" />}
                    {p.isLocked ? "Locked" : "Open"}
                  </span>
                </div>
                <div className="mt-1 h-4 text-[0.6875rem] text-[var(--ink-400)]">
                  {p.isLocked && p.lockedAt ? `since ${fmtDate(p.lockedAt)}` : ""}
                </div>
                {p.isLocked ? (
                  <form action={togglePeriodLockAction} className="mt-3">
                    <input type="hidden" name="entityId" value={entityId} />
                    <input type="hidden" name="year" value={p.year} />
                    <input type="hidden" name="month" value={p.month} />
                    <input type="hidden" name="lock" value="false" />
                    <button className="btn btn-secondary btn-sm w-full">
                      <IconUnlock className="h-3.5 w-3.5" />
                      Unlock
                    </button>
                  </form>
                ) : (
                  <a
                    href={`/accountant/${entityId}/periods/close?year=${p.year}&month=${p.month}`}
                    className="btn btn-secondary btn-sm mt-3 w-full"
                  >
                    <IconLock className="h-3.5 w-3.5" />
                    Review &amp; lock
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
