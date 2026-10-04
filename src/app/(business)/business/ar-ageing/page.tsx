import { redirect } from "next/navigation";
import { guardPortal } from "@/lib/business-guard";
import { getArAgeing } from "@/services/ageing";
import { todayIso, fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";

export default async function BusinessArAgeingPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const ctx = await guardPortal("sales");
  if (!ctx.allowed.has("reports")) redirect("/business?denied=reports");
  const requested = (await searchParams).asOf;
  const asOf = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayIso();
  const report = await getArAgeing(ctx.entityId, asOf);
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="A/R Ageing" sub="Customer invoices by due date"><form className="flex items-end gap-2"><label className="field-label">As at<input type="date" name="asOf" defaultValue={asOf} className="input mt-1 w-40" /></label><button className="btn btn-secondary">Run</button></form><a className="btn btn-secondary" href={`/business/export/ar-ageing?asOf=${asOf}`}>Export CSV</a></PageHeader>
    {!report.tiesOut && <p role="alert" className="banner banner-warn mb-4">Invoice balances do not match the receivables account. Ask your accountant to investigate.</p>}
    <div className="card overflow-x-auto"><table className="tbl"><caption className="p-4 text-left font-semibold">Open invoices as at {asOf}</caption><thead><tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Due</th><th scope="col" className="text-right">Outstanding</th></tr></thead><tbody>
      {report.rows.map(row => <tr key={row.documentId}><td>{row.documentNumber}</td><td>{row.contactName}</td><td>{fmtDate(row.dueDate)}</td><td className="td-num">{fmtMoney(row.outstanding)}</td></tr>)}
      <tr className="font-semibold"><td colSpan={3}>Total outstanding</td><td className="td-num">{fmtMoney(report.total)}</td></tr>
    </tbody></table></div>
  </main>;
}
