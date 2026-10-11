import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settlements } from "@/db/schema";
import { guardPortal } from "@/lib/business-guard";
import { getInvoice } from "@/services/invoices";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function CreditNotePage({ params }: { params: Promise<{ settlementId: string }> }) {
  const portal = await guardPortal("sales");
  const { settlementId } = await params;
  const [credit] = await db.select().from(settlements).where(and(
    eq(settlements.id, settlementId), eq(settlements.entityId, portal.entityId), eq(settlements.kind, "credit_note")
  ));
  if (!credit?.invoiceId) notFound();
  const data = await getInvoice(credit.invoiceId, portal.entityId);
  if (!data) notFound();
  return <main className="mx-auto max-w-3xl px-6 py-8">
    <PageHeader title="Credit note" sub={`Against invoice ${data.invoice.invoiceNumber}`}><PrintButton /></PageHeader>
    <div className="card space-y-5 p-6">
      <div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs uppercase text-[var(--ink-500)]">Issued by</p><p className="font-semibold">{portal.entityName}</p></div><div><p className="text-xs uppercase text-[var(--ink-500)]">Issued to</p><p className="font-semibold">{data.customer?.name}</p></div></div>
      <dl className="grid gap-4 border-y border-[var(--ink-100)] py-4 sm:grid-cols-2"><div><dt className="text-xs text-[var(--ink-500)]">Original invoice</dt><dd>{data.invoice.invoiceNumber}</dd></div><div><dt className="text-xs text-[var(--ink-500)]">Credit date</dt><dd>{fmtDate(credit.date)}</dd></div><div><dt className="text-xs text-[var(--ink-500)]">Reference</dt><dd>{credit.reference ?? "—"}</dd></div><div><dt className="text-xs text-[var(--ink-500)]">Original invoice total</dt><dd>{fmtMoney(data.invoice.total)}</dd></div></dl>
      <div className="flex justify-between text-lg font-semibold"><span>Credit amount</span><span>{fmtMoney(credit.amount)}</span></div>
      <p className="text-sm text-[var(--ink-500)]">This credit is linked to the original invoice and recorded in the ledger.</p>
    </div>
  </main>;
}
