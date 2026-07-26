import { BUCKET_LABELS, type AgeingReport } from "@/services/ageing";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconCheck, IconAlert, IconRows } from "@/components/icons";

/** Shared presentation for AR and AP ageing (spec 6.2 / 7.2). */
export function AgeingReportView({
  title,
  sub,
  report,
  entityId,
  documentHref,
  contactLabel,
}: {
  title: string;
  sub: string;
  report: AgeingReport;
  entityId: string;
  documentHref: (id: string) => string;
  contactLabel: string;
}) {
  return (
    <div className="fade-up">
      <PageHeader title={title} sub={sub}>
        <form className="flex items-end gap-2">
          <div>
            <label className="field-label">As at</label>
            <input type="date" name="asOf" defaultValue={report.asOf} className="input w-40" />
          </div>
          <button className="btn btn-secondary">Run</button>
        </form>
      </PageHeader>

      {/* Bucket summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKET_LABELS.map((label, i) => (
          <div key={label} className="card p-4">
            <div className="text-xs font-medium text-[var(--ink-500)]">{label}</div>
            <div
              className={`num mt-1 text-[0.9375rem] font-semibold ${
                i >= 3 && Number(report.bucketTotals[i]) > 0
                  ? "text-[var(--negative)]"
                  : "text-[var(--ink-900)]"
              }`}
            >
              {fmtMoney(report.bucketTotals[i])}
            </div>
          </div>
        ))}
      </div>

      {/* Control account reconciliation */}
      {report.tiesOut ? (
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ties out to the control account {report.controlAccountLabel} ({fmtMoney(report.total)}).
          </span>
        </div>
      ) : (
        <div className="banner banner-warn mb-4">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Open items total {fmtMoney(report.total)} but control account{" "}
            {report.controlAccountLabel} shows {fmtMoney(report.controlBalance)} — a difference of{" "}
            {fmtMoney(report.difference)}. This happens when journal entries post directly to the
            control account instead of through invoices or bills.
          </span>
        </div>
      )}

      <div className="card overflow-x-auto">
        {report.rows.length === 0 ? (
          <EmptyState
            icon={<IconRows className="h-5 w-5" />}
            title="Nothing outstanding"
            hint={`No open items as at ${report.asOf}.`}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Document</th>
                <th>{contactLabel}</th>
                <th>Due</th>
                <th className="text-right">Days overdue</th>
                <th>Bucket</th>
                <th className="text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.documentId} className="tbl-row-link">
                  <td className="acct">
                    <a
                      href={documentHref(r.documentId)}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {r.documentNumber}
                    </a>
                  </td>
                  <td className="font-medium text-[var(--ink-800)]">{r.contactName}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.dueDate)}</td>
                  <td className="td-num">{r.daysOverdue > 0 ? r.daysOverdue : "—"}</td>
                  <td>
                    <span
                      className={`badge ${
                        r.bucket === 0
                          ? "badge-posted"
                          : r.bucket >= 3
                            ? "badge-voided"
                            : "badge-pending"
                      }`}
                    >
                      {BUCKET_LABELS[r.bucket]}
                    </span>
                  </td>
                  <td className="td-num font-medium">{fmtMoney(r.outstanding)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right text-xs uppercase tracking-wide">
                  Total outstanding
                </td>
                <td className="td-num">{fmtMoney(report.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="kbd-hint mt-2">
        Live read as at {report.asOf} · entity {entityId.slice(0, 8)}
      </p>
    </div>
  );
}
