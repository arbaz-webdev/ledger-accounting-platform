import { getFyStatus, listFyCloses } from "@/services/year-end";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui";
import { closeYearAction, reopenYearAction } from "../actions";

export default async function YearEndPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ year?: string; error?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const startYear = Number(sp.year) || Number(todayIso().slice(0, 4));
  const [status, history] = await Promise.all([
    getFyStatus(entityId, startYear),
    listFyCloses(entityId),
  ]);
  const isClosed = status.close !== null;

  return (
    <div className="fade-up">
      <PageHeader
        title={`Year-end close · ${status.range.label}`}
        sub={`${fmtDate(status.range.start)} – ${fmtDate(status.range.end)}`}
      >
        <div className="flex items-center gap-2">
          <a
            href={`/accountant/${entityId}/periods/year-end?year=${startYear - 1}`}
            className="btn btn-secondary btn-sm"
          >
            ← {startYear - 1}
          </a>
          <a
            href={`/accountant/${entityId}/periods/year-end?year=${startYear + 1}`}
            className="btn btn-secondary btn-sm"
          >
            {startYear + 1} →
          </a>
          <a href={`/accountant/${entityId}/periods?year=${startYear}`} className="btn btn-secondary btn-sm">
            Periods
          </a>
        </div>
      </PageHeader>

      {sp.error && (
        <div className="banner banner-error mb-4" role="alert">
          {sp.error}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={`Net ${Number(status.yearProfit) < 0 ? "loss" : "profit"} for the year`}
          value={fmtMoney(status.yearProfit)}
          accent={Number(status.yearProfit) < 0 ? "negative" : "brand"}
        />
        <StatCard
          label="Periods locked"
          value={`${status.periodsLocked} / ${status.periodsTotal}`}
          hint={isClosed ? "Locked by the year-end close" : "Lock months as you finish them"}
        />
        <StatCard
          label="Status"
          value={isClosed ? "Closed" : "Open"}
          hint={
            isClosed && status.close
              ? `on ${fmtDate(status.close.closedAt.toString())}`
              : "Books still accept postings in open periods"
          }
        />
      </div>

      {isClosed && status.close ? (
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ink-900)]">
            {status.close.label} is closed
          </h2>
          <p className="mb-4 text-[0.8125rem] text-[var(--ink-500)]">
            Net result {fmtMoney(status.close.netProfit)} was transferred to retained earnings
            {status.close.jeNumber ? (
              <>
                {" "}by closing entry{" "}
                <a
                  href={`/accountant/${entityId}/journal/${status.close.jeId}`}
                  className="font-medium text-[var(--brand-700)] hover:underline"
                >
                  JE #{status.close.jeNumber}
                </a>
              </>
            ) : (
              " (no journal entry was needed — every P&L account was already at zero)"
            )}
            . All periods of the year are locked.
          </p>
          <form action={reopenYearAction} className="flex items-center gap-3">
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="closeId" value={status.close.id} />
            <input type="hidden" name="startYear" value={startYear} />
            <label className="field-label" htmlFor="reopen-reason">Reopening reason</label>
            <input id="reopen-reason" name="reason" className="input" required minLength={5} maxLength={500} />
            <label className="text-xs"><input type="checkbox" name="confirmed" required /> Confirm reversal and reopening</label>
            <button className="btn btn-danger">Reopen {status.close.label}</button>
            <span className="kbd-hint">
              Voids the closing entry (reversal dated {fmtDate(status.range.end)}) and unlocks the
              final period.
            </span>
          </form>
        </div>
      ) : (
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ink-900)]">
            Close {status.range.label}
          </h2>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-[0.8125rem] text-[var(--ink-500)]">
            <li>
              Posts one closing entry dated {fmtDate(status.range.end)} zeroing every revenue and
              expense account into retained earnings
              {status.sweepIncludesPrior && (
                <>
                  {" "}
                  — the sweep total {fmtMoney(status.sweepTotal)} includes unclosed prior-year
                  balances
                </>
              )}
              .
            </li>
            <li>Locks all {status.periodsTotal} periods of the fiscal year.</li>
            <li>Reopening later voids the closing entry — nothing is ever deleted.</li>
          </ul>
          {status.finalPeriodLocked && (
            <div className="banner banner-warn mb-4">
              <span>
                The final period is locked, so the closing entry cannot post. Unlock{" "}
                {fmtDate(status.range.end).slice(3)} first.
              </span>
            </div>
          )}
          {status.periodsLocked < status.periodsTotal - 1 && (
            <div className="banner banner-warn mb-4">
              <span>
                Only {status.periodsLocked} of {status.periodsTotal} months are locked — consider
                completing each month-end close first (advisory).
              </span>
            </div>
          )}
          <form action={closeYearAction} className="flex items-center gap-3">
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="startYear" value={startYear} />
            <button className="btn btn-brand" disabled={status.finalPeriodLocked || !status.hasActivity}>
              Close {status.range.label} ({fmtMoney(status.sweepTotal)} to retained earnings)
            </button>
          </form>
          {!status.hasActivity && <p className="mt-2 text-sm" role="status">This fiscal year has no posted activity and cannot be closed.</p>}
        </div>
      )}

      {history.length > 0 && (
        <div className="card mt-5 overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Close history</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th>
                <th>Closed</th>
                <th className="text-right">Net result</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="font-medium text-[var(--ink-800)]">{h.label}</td>
                  <td className="whitespace-nowrap">{fmtDate(h.closedAt.toString())}</td>
                  <td className="td-num">{fmtMoney(h.netProfit)}</td>
                  <td className="text-right">
                    {h.reopenedAt ? (
                      <span className="badge badge-voided">
                        <span className="badge-dot" />
                        Reopened {fmtDate(h.reopenedAt.toString())}
                      </span>
                    ) : (
                      <span className="badge badge-posted">
                        <span className="badge-dot" />
                        Closed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
