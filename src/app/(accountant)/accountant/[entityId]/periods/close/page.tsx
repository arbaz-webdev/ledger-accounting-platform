import { notFound } from "next/navigation";
import { preCloseChecks } from "@/services/period-close";
import { listPeriods } from "@/services/periods";
import { PageHeader } from "@/components/ui";
import { IconLock } from "@/components/icons";
import { confirmLockAction } from "../actions";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function CloseReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const year = Number(sp.year);
  const month = Number(sp.month);
  if (!year || !month || month < 1 || month > 12) notFound();

  const rows = await listPeriods(entityId, year);
  const period = rows.find((p) => p.month === month);
  if (!period) notFound();

  const checks = await preCloseChecks(entityId, year, month);
  const failing = checks.filter((c) => !c.ok);
  const suspenseBlocked = failing.some(c => c.key === "suspense");

  return (
    <div className="fade-up">
      <PageHeader
        title={`Close ${MONTHS[month - 1]} ${year}`}
        sub="Suspense must be clear before locking. Other reconciliation warnings remain advisory."
      >
        <a href={`/accountant/${entityId}/periods?year=${year}`} className="btn btn-secondary">
          Back to periods
        </a>
      </PageHeader>

      {period.isLocked && (
        <div className="banner banner-warn mb-4">
          <span>This period is already locked.</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">
            {failing.length === 0
              ? "All checks pass"
              : `${failing.length} of ${checks.length} checks need attention`}
          </h2>
        </div>
        <table className="tbl">
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td className="w-10 text-center">
                  {c.ok ? (
                    <span className="badge badge-posted"><span className="badge-dot" />OK</span>
                  ) : (
                    <span className="badge badge-pending"><span className="badge-dot" />Check</span>
                  )}
                </td>
                <td className="font-medium text-[var(--ink-800)]">{c.label}</td>
                <td className="text-[0.8125rem] text-[var(--ink-500)]">{c.detail}</td>
                <td className="text-right">
                  {!c.ok && c.fixPath && (
                    <a
                      href={`/accountant/${entityId}${c.fixPath}`}
                      className="btn btn-ghost btn-sm"
                    >
                      Review →
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!period.isLocked && (
        <form action={confirmLockAction} className="mt-4 flex items-center gap-3">
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <button className="btn btn-brand" disabled={suspenseBlocked}>
            <IconLock className="h-4 w-4" />
            {suspenseBlocked ? "Resolve suspense before locking" : failing.length === 0
              ? `Lock ${MONTHS[month - 1]} ${year}`
              : `Lock anyway (${failing.length} warning${failing.length === 1 ? "" : "s"})`}
          </button>
          <span className="kbd-hint">
            Locking rejects all postings dated in this period — enforced by the database.
          </span>
        </form>
      )}
    </div>
  );
}
