import { getDayBook } from "@/services/reports";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { ExportButton, PrintButton } from "@/components/export-button";

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  invoice: "Invoice",
  bill: "Bill",
  payroll: "Payroll",
  bank: "Bank",
  inventory: "Inventory",
  system: "System",
};

export default async function DayBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;

  const today = todayIso();
  const from = isDate(sp.from) ? sp.from! : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.to) ? sp.to! : today;

  const book = await getDayBook(entityId, from, to);

  return (
    <div className="fade-up">
      <PageHeader
        title="Day book"
        sub={`${book.count} journal entries · total ${fmtMoney(book.grandTotal)}`}
      >
        <form className="flex items-end gap-2">
          <div>
            <label className="field-label">From</label>
            <input type="date" name="from" defaultValue={from} className="input w-40" />
          </div>
          <div>
            <label className="field-label">To</label>
            <input type="date" name="to" defaultValue={to} className="input w-40" />
          </div>
          <button className="btn btn-secondary">Run</button>
        </form>
        <ExportButton entityId={entityId} report="day-book" params={{ from, to }} />
        <PrintButton />
      </PageHeader>

      {book.truncated && (
        <div className="banner banner-warn mb-4">
          <span>Showing the first {book.count} entries — narrow the date range to see the rest.</span>
        </div>
      )}

      <div className="card overflow-x-auto">
        {book.rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-[0.8125rem] text-[var(--ink-400)]">
            No journal entries in this range.
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>JE #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th>Source</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {book.rows.map((r) => (
                <tr key={r.jeId} className="tbl-row-link">
                  <td className="acct">
                    <a
                      href={`/accountant/${entityId}/journal/${r.jeId}`}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      #{r.jeNumber}
                    </a>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="max-w-72 truncate font-medium text-[var(--ink-800)]">
                    {r.description}
                  </td>
                  <td className="acct">{r.reference ?? ""}</td>
                  <td className="text-[var(--ink-500)]">{SOURCE_LABELS[r.sourceModule] ?? r.sourceModule}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="td-num">{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={6}>Total</td>
                <td className="td-num">{fmtMoney(book.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
