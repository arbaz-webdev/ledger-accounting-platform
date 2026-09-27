import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalEntryLines, chartOfAccounts } from "@/db/schema";
import { fmtDate, fmtMoney } from "@/lib/format";
import { voidJournalEntryAction, postDraftAction, discardDraftAction } from "../actions";
import { PageHeader, StatusBadge } from "@/components/ui";

export default async function JournalEntryDetail({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string; jeId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId, jeId } = await params;
  const { error } = await searchParams;

  const jeRows = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, jeId), eq(journalEntries.entityId, entityId)));
  const je = jeRows[0];
  if (!je) notFound();

  const lines = await db
    .select({
      lineNo: journalEntryLines.lineNo,
      accountNumber: chartOfAccounts.accountNumber,
      accountName: chartOfAccounts.name,
      description: journalEntryLines.description,
      debit: journalEntryLines.debitBase,
      credit: journalEntryLines.creditBase,
    })
    .from(journalEntryLines)
    .innerJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
    .where(eq(journalEntryLines.jeId, jeId))
    .orderBy(asc(journalEntryLines.lineNo));

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="fade-up">
      <PageHeader
        title={`Journal entry ${je.jeNumber ? `#${je.jeNumber}` : "(draft)"}`}
        sub={`${fmtDate(je.date)} · ${je.sourceModule.toUpperCase()}${je.reference ? ` · Ref ${je.reference}` : ""}`}
      >
        {je.status === "posted" && !je.reversesJeId && ["manual", "system"].includes(je.sourceModule) && (
          <form action={voidJournalEntryAction}>
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="jeId" value={je.id} />
            <button className="btn btn-danger">Void (create reversal)</button>
          </form>
        )}
        {(je.status === "draft" || je.status === "pending_approval") && (
          <>
            <form action={discardDraftAction}>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="jeId" value={je.id} />
              <button className="btn btn-secondary">Discard draft</button>
            </form>
            <form action={postDraftAction}>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="jeId" value={je.id} />
              <button className="btn btn-brand">Post entry</button>
            </form>
          </>
        )}
      </PageHeader>

      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={je.status} />
        <span className="text-sm text-[var(--ink-700)]">{je.description}</span>
      </div>

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      {(je.voidedByJeId || je.reversesJeId) && (
        <div className="banner banner-warn mb-4">
          {je.voidedByJeId && (
            <a
              href={`/accountant/${entityId}/journal/${je.voidedByJeId}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              This entry was reversed — view the reversal entry →
            </a>
          )}
          {je.reversesJeId && (
            <a
              href={`/accountant/${entityId}/journal/${je.reversesJeId}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              This is a reversal — view the original entry →
            </a>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>Account</th>
              <th>Description</th>
              <th className="w-36 text-right">Debit</th>
              <th className="w-36 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="text-[var(--ink-300)]">{l.lineNo}</td>
                <td>
                  <span className="acct mr-2">{l.accountNumber}</span>
                  <span className="font-medium text-[var(--ink-800)]">{l.accountName}</span>
                </td>
                <td className="text-[var(--ink-500)]">{l.description}</td>
                <td className="td-num">{Number(l.debit) > 0 ? fmtMoney(l.debit) : ""}</td>
                <td className="td-num">{Number(l.credit) > 0 ? fmtMoney(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="text-right text-xs uppercase tracking-wide text-[var(--ink-500)]">
                Totals
              </td>
              <td className="td-num">{fmtMoney(totalDebit)}</td>
              <td className="td-num">{fmtMoney(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
