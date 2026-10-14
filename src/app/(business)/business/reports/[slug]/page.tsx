import { notFound } from "next/navigation";
import { guardPortal } from "@/lib/business-guard";
import { getPortalCatalogReport, PORTAL_REPORTS, type PortalReportSlug } from "@/services/portal-report-catalog";
import { defaultFiscalRange } from "@/services/statements";
import { todayIso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function PortalCatalogReportPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { slug } = await params;
  if (!(slug in PORTAL_REPORTS)) notFound();
  const portal = await guardPortal("reports");
  if (["inventory-valuation","inventory-movements","sales-by-item"].includes(slug) && !portal.allowed.has("inventory")) notFound();
  if (slug === "sales-by-item" && !portal.allowed.has("sales")) notFound();
  if (slug === "sales-by-customer" && !portal.allowed.has("sales")) notFound();
  if (slug === "purchases-by-vendor" && !portal.allowed.has("purchases")) notFound();
  const sp = await searchParams;
  const today = todayIso();
  const defaults = defaultFiscalRange(today, portal.fiscalYearStartMonth);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : defaults.from;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  if (from > to) notFound();
  const report = PORTAL_REPORTS[slug as PortalReportSlug];
  const data = await getPortalCatalogReport(portal.entityId, slug as PortalReportSlug, from, to);
  const query = new URLSearchParams({ from, to });
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title={report.title} sub={report.description}>
      <a href={`/business/export/${slug}?${query}`} className="btn btn-secondary no-print">Export CSV</a><PrintButton />
    </PageHeader>
    {slug !== "inventory-valuation" && <form className="card mb-5 flex flex-wrap items-end gap-3 p-4 no-print">
      <label><span className="field-label">From</span><input name="from" type="date" defaultValue={from} className="input" /></label>
      <label><span className="field-label">To</span><input name="to" type="date" defaultValue={to} className="input" /></label>
      <button className="btn btn-brand">Run report</button>
    </form>}
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr>{data.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
      {data.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}
    </tbody></table>{data.rows.length === 0 && <p className="p-4 text-sm text-[var(--ink-500)]">No data for this period.</p>}</div>
  </main>;
}
