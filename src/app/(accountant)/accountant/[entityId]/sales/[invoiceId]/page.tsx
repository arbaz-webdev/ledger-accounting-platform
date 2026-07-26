import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { chartOfAccounts } from "@/db/schema";
import { getInvoice } from "@/services/invoices";
import { resolveMapping } from "@/services/mappings";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { postInvoiceAction, discardInvoiceAction, settleInvoiceAction } from "../actions";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
  void: "badge-voided",
};

const KIND_LABEL: Record<string, string> = {
  payment: "Payment received",
  credit_note: "Credit note",
  write_off: "Bad debt write-off",
};

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string; invoiceId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId, invoiceId } = await params;
  const { error } = await searchParams;

  const data = await getInvoice(invoiceId, entityId);
  if (!data) notFound();
  const { invoice, customer, lines, settlements, outstanding } = data;

  const bankAccounts = await db
    .select({ id: chartOfAccounts.id, number: chartOfAccounts.accountNumber, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.entityId, entityId), eq(chartOfAccounts.type, "asset")));
  const defaultBank = await resolveMapping(entityId, "default_bank").catch(() => null);

  const isOpen = invoice.status === "posted" && Number(outstanding) > 0;

  return (
    <div className="fade-up">
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        sub={`${customer?.name ?? "Customer"} · issued ${fmtDate(invoice.issueDate)} · due ${fmtDate(invoice.dueDate)}`}
      >
        {invoice.status === "draft" && (
          <>
            <form action={discardInvoiceAction}>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button className="btn btn-secondary">Discard</button>
            </form>
            <form action={postInvoiceAction}>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button className="btn btn-brand">Post invoice</button>
            </form>
          </>
        )}
        {invoice.jeId && (
          <a href={`/accountant/${entityId}/journal/${invoice.jeId}`} className="btn btn-secondary">
            View journal entry
          </a>
        )}
      </PageHeader>

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={`badge ${STATUS_BADGE[invoice.status] ?? "badge-neutral"}`}>
          <span className="badge-dot" />
          {invoice.status}
        </span>
        <span className="text-sm text-[var(--ink-500)]">
          Outstanding{" "}
          <span className="num font-semibold text-[var(--ink-900)]">{fmtMoney(outstanding)}</span>{" "}
          of {fmtMoney(invoice.total)}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Description</th>
              <th>Account</th>
              <th className="w-20 text-right">Qty</th>
              <th className="w-28 text-right">Unit price</th>
              <th className="w-24 text-right">Tax</th>
              <th className="w-28 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="font-medium text-[var(--ink-800)]">{l.description}</td>
                <td>
                  <span className="acct mr-2">{l.accountNumber}</span>
                  {l.accountName}
                </td>
                <td className="td-num">{Number(l.quantity)}</td>
                <td className="td-num">{fmtMoney(l.unitPrice)}</td>
                <td className="td-num">{fmtMoney(l.taxAmount)}</td>
                <td className="td-num">{fmtMoney(l.netAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}></td>
              <td className="td-num text-xs uppercase tracking-wide">Subtotal</td>
              <td className="td-num">{fmtMoney(invoice.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={4}></td>
              <td className="td-num text-xs uppercase tracking-wide">Tax</td>
              <td className="td-num">{fmtMoney(invoice.taxTotal)}</td>
            </tr>
            <tr>
              <td colSpan={4}></td>
              <td className="td-num text-xs uppercase tracking-wide">Total</td>
              <td className="td-num text-[0.9375rem]">{fmtMoney(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Settlements */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="card overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Payments &amp; credits</h2>
          </div>
          {settlements.length === 0 ? (
            <p className="px-5 py-8 text-center text-[0.8125rem] text-[var(--ink-400)]">
              Nothing recorded against this invoice yet.
            </p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{fmtDate(s.date)}</td>
                    <td>{KIND_LABEL[s.kind] ?? s.kind}</td>
                    <td className="acct">
                      {s.jeId ? (
                        <a
                          href={`/accountant/${entityId}/journal/${s.jeId}`}
                          className="hover:text-[var(--brand-700)] hover:underline"
                        >
                          {s.reference ?? "journal entry"}
                        </a>
                      ) : (
                        (s.reference ?? "")
                      )}
                    </td>
                    <td className="td-num">{fmtMoney(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {isOpen && (
          <form action={settleInvoiceAction} className="card h-fit p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--ink-900)]">Record settlement</h2>
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="invoiceId" value={invoice.id} />

            <div className="space-y-3">
              <div>
                <label className="field-label">Type</label>
                <select name="kind" className="select" defaultValue="payment">
                  <option value="payment">Payment received</option>
                  <option value="credit_note">Credit note</option>
                  <option value="write_off">Bad debt write-off</option>
                </select>
              </div>
              <div>
                <label className="field-label">Date</label>
                <input type="date" name="date" defaultValue={todayIso()} className="input" />
              </div>
              <div>
                <label className="field-label">Amount</label>
                <input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={outstanding}
                  className="input num text-right"
                />
              </div>
              <div>
                <label className="field-label">Bank account (payments)</label>
                <select name="bankAccountId" className="select" defaultValue={defaultBank ?? ""}>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.number} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Reference</label>
                <input name="reference" placeholder="Optional" className="input" />
              </div>
              <button className="btn btn-brand w-full">Record</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
