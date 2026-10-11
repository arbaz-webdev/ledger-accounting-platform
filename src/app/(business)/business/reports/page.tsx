import { guardPortal } from "@/lib/business-guard";
import { PageHeader } from "@/components/ui";
import { PORTAL_REPORTS } from "@/services/portal-report-catalog";

const REPORTS = [
  { href: "/business/profit-loss", title: "Profit & Loss", description: "Revenue, cost of goods sold, expenses and net result." },
  { href: "/business/balance-sheet", title: "Balance Sheet", description: "Assets, liabilities and equity at a chosen date." },
  { href: "/business/cash-flow", title: "Cash Flow", description: "Cash from operations, investing and financing." },
  { href: "/business/ar-ageing", title: "Customer ageing", description: "Outstanding invoices grouped by age." },
  { href: "/business/ap-ageing", title: "Supplier ageing", description: "Outstanding bills grouped by age." },
] as const;

export default async function BusinessReportsPage() {
  const { allowed } = await guardPortal("reports");
  const reports = [...REPORTS, ...Object.entries(PORTAL_REPORTS).map(([slug, item]) => ({ href: `/business/reports/${slug}`, title: item.title, description: item.description }))].filter((report) =>
    report.href.includes("ar-ageing") ? allowed.has("sales") :
    report.href.includes("ap-ageing") ? allowed.has("purchases") :
    report.href.includes("inventory-valuation") ? allowed.has("inventory") :
    report.href.includes("sales-by-customer") ? allowed.has("sales") :
    report.href.includes("purchases-by-vendor") ? allowed.has("purchases") : true
  );
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Reports" sub="Choose a statement or an outstanding balance report." />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((report) => <a key={report.href} href={report.href} className="card block p-5 hover:border-[var(--brand-500)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">
        <h2 className="font-semibold text-[var(--ink-900)]">{report.title}</h2>
        <p className="mt-2 text-sm text-[var(--ink-500)]">{report.description}</p>
      </a>)}
    </div>
  </main>;
}
