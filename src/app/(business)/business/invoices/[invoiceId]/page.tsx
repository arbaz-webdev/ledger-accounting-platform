import { notFound } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { hasModule } from "@/services/permissions";
import { getInvoice } from "@/services/invoices";
import { listCashBankAccounts } from "@/services/coa";
import { resolveMapping } from "@/services/mappings";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { postBusinessInvoiceAction, discardBusinessInvoiceAction, settleBusinessInvoiceAction } from "../actions";

export default async function BusinessInvoicePage({ params, searchParams }: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await portalContext();
  if (!(await hasModule(ctx.user, ctx.entityId, "sales"))) notFound();
  const { invoiceId } = await params;
  const { error } = await searchParams;
  const data = await getInvoice(invoiceId, ctx.entityId);
  if (!data) notFound();
  const canEdit = await hasModule(ctx.user, ctx.entityId, "sales", "edit");
  const { invoice, customer, lines, settlements, outstanding } = data;
  const bankAccounts = canEdit ? await listCashBankAccounts(ctx.entityId) : [];
  const defaultBank = canEdit ? await resolveMapping(ctx.entityId, "default_bank").catch(() => null) : null;
  const canSettle = canEdit && invoice.status === "posted" && Number(outstanding) > 0;

  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title={`Invoice ${invoice.invoiceNumber}`} sub={`${customer?.name ?? "Customer"} · issued ${fmtDate(invoice.issueDate)} · due ${fmtDate(invoice.dueDate)}`}>
      {canEdit && invoice.status === "draft" && <>
        <form action={discardBusinessInvoiceAction}><input type="hidden" name="entityId" value={ctx.entityId} /><input type="hidden" name="invoiceId" value={invoice.id} /><button className="btn btn-secondary">Discard draft</button></form>
        <form action={postBusinessInvoiceAction}><input type="hidden" name="entityId" value={ctx.entityId} /><input type="hidden" name="invoiceId" value={invoice.id} /><button className="btn btn-brand">Post invoice</button></form>
      </>}
    </PageHeader>
    {error && <div className="banner banner-error mb-4" role="alert">{error}</div>}
    <p className="mb-4 text-sm"><span className="badge badge-info">{invoice.status}</span> <span className="ml-2">Outstanding {fmtMoney(outstanding)} of {fmtMoney(invoice.total)}</span></p>
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>Description</th><th>Account</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Tax</th><th className="text-right">Net</th></tr></thead><tbody>
      {lines.map((line) => <tr key={line.lineNo}><td>{line.description}</td><td>{line.accountNumber} {line.accountName}</td><td className="td-num">{Number(line.quantity)}</td><td className="td-num">{fmtMoney(line.unitPrice)}</td><td className="td-num">{fmtMoney(line.taxAmount)}</td><td className="td-num">{fmtMoney(line.netAmount)}</td></tr>)}
    </tbody><tfoot><tr><td colSpan={5}>Total</td><td className="td-num">{fmtMoney(invoice.total)}</td></tr></tfoot></table></div>
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
      <section className="card overflow-x-auto"><h2 className="border-b border-[var(--ink-100)] p-4 text-sm font-semibold">Payments, credits and write-offs</h2>
        {settlements.length ? <table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="text-right">Amount</th></tr></thead><tbody>
          {settlements.map((settlement) => <tr key={settlement.id}><td>{fmtDate(settlement.date)}</td><td>{settlement.kind.replaceAll("_", " ")}</td><td>{settlement.reference}</td><td className="td-num">{fmtMoney(settlement.amount)}</td></tr>)}
        </tbody></table> : <p className="p-4 text-sm text-[var(--ink-500)]">No payments or credits yet.</p>}
      </section>
      {canSettle && <form action={settleBusinessInvoiceAction} className="card h-fit space-y-3 p-4">
        <h2 className="text-sm font-semibold">Record settlement</h2>
        <input type="hidden" name="entityId" value={ctx.entityId} /><input type="hidden" name="invoiceId" value={invoice.id} />
        <label className="block"><span className="field-label">Type</span><select name="kind" className="select"><option value="payment">Payment received</option><option value="credit_note">Credit note</option><option value="write_off">Bad debt write-off</option></select></label>
        <label className="block"><span className="field-label">Date</span><input name="date" type="date" required defaultValue={todayIso()} className="input" /></label>
        <label className="block"><span className="field-label">Amount</span><input name="amount" inputMode="decimal" required defaultValue={outstanding} className="input num" /></label>
        <label className="block"><span className="field-label">Bank account (for payments)</span><select name="bankAccountId" className="select" defaultValue={defaultBank ?? ""}>{bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.number} — {bank.name}</option>)}</select></label>
        <label className="block"><span className="field-label">Reference</span><input name="reference" className="input" /></label>
        <button className="btn btn-brand w-full">Record</button>
      </form>}
    </div>
  </main>;
}
