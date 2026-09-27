import { notFound } from "next/navigation";
import { listCashBankAccounts } from "@/services/coa";
import { getBill } from "@/services/bills";
import { resolveMapping } from "@/services/mappings";
import { fmtDate, fmtMoney, fmtUnitPrice, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { postBillAction, discardBillAction, settleBillAction } from "../actions";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
  void: "badge-voided",
};

const KIND_LABEL: Record<string, string> = {
  payment: "Payment made",
  credit_note: "Supplier credit note",
};

export default async function BillDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string; billId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId, billId } = await params;
  const { error } = await searchParams;

  const data = await getBill(billId, entityId);
  if (!data) notFound();
  const { bill, supplier, lines, settlements, outstanding } = data;

  const bankAccounts = await listCashBankAccounts(entityId);
  const defaultBank = await resolveMapping(entityId, "default_bank").catch(() => null);

  const isOpen = bill.status === "posted" && Number(outstanding) > 0;

  return (
    <div className="fade-up">
      <PageHeader
        title={`Bill ${bill.billNumber}`}
        sub={`${supplier?.name ?? "Supplier"} · issued ${fmtDate(bill.issueDate)} · due ${fmtDate(bill.dueDate)}`}
      >
        {bill.status === "draft" && (
          <>
            <form action={discardBillAction}>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="billId" value={bill.id} />
              <button className="btn btn-secondary">Discard</button>
            </form>
            <form action={postBillAction}>
              <input type="hidden" name="entityId" value={entityId} />
              <input type="hidden" name="billId" value={bill.id} />
              <button className="btn btn-brand">Post bill</button>
            </form>
          </>
        )}
        {bill.jeId && (
          <a href={`/accountant/${entityId}/journal/${bill.jeId}`} className="btn btn-secondary">
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
        <span className={`badge ${STATUS_BADGE[bill.status] ?? "badge-neutral"}`}>
          <span className="badge-dot" />
          {bill.status}
        </span>
        <span className="text-sm text-[var(--ink-500)]">
          Outstanding{" "}
          <span className="num font-semibold text-[var(--ink-900)]">{fmtMoney(outstanding)}</span>{" "}
          of {fmtMoney(bill.total)}
        </span>
        {bill.supplierReference && (
          <span className="text-sm text-[var(--ink-500)]">Ref {bill.supplierReference}</span>
        )}
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
                <td className="td-num">{fmtUnitPrice(l.unitPrice)}</td>
                <td className="td-num">{fmtMoney(l.taxAmount)}</td>
                <td className="td-num">{fmtMoney(l.netAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}></td>
              <td className="td-num text-xs uppercase tracking-wide">Subtotal</td>
              <td className="td-num">{fmtMoney(bill.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={4}></td>
              <td className="td-num text-xs uppercase tracking-wide">Tax</td>
              <td className="td-num">{fmtMoney(bill.taxTotal)}</td>
            </tr>
            <tr>
              <td colSpan={4}></td>
              <td className="td-num text-xs uppercase tracking-wide">Total</td>
              <td className="td-num text-[0.9375rem]">{fmtMoney(bill.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="card overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Payments &amp; credits</h2>
          </div>
          {settlements.length === 0 ? (
            <p className="px-5 py-8 text-center text-[0.8125rem] text-[var(--ink-400)]">
              Nothing recorded against this bill yet.
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
          <form action={settleBillAction} className="card h-fit p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--ink-900)]">Record settlement</h2>
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="billId" value={bill.id} />

            <div className="space-y-3">
              <div>
                <label className="field-label">Type</label>
                <select name="kind" className="select" defaultValue="payment">
                  <option value="payment">Payment made</option>
                  <option value="credit_note">Supplier credit note</option>
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
