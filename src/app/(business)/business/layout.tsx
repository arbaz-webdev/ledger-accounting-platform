import { portalContext } from "@/lib/business-guard";
import { Topbar } from "@/components/topbar";

import type { ModuleKey } from "@/services/permissions";
import { hasModule } from "@/services/permissions";

const GROUPS: { label: string; links: { href: string; label: string; module: ModuleKey }[] }[] = [
  { label: "Documents", links: [
    { href: "/business/invoices", label: "Invoices", module: "sales" },
    { href: "/business/bills", label: "Bills", module: "purchases" },
  ] },
  { label: "Reports", links: [
    { href: "/business/reports", label: "All reports", module: "reports" },
    { href: "/business/profit-loss", label: "Profit & Loss", module: "reports" },
    { href: "/business/balance-sheet", label: "Balance Sheet", module: "reports" },
    { href: "/business/cash-flow", label: "Cash Flow", module: "reports" },
    { href: "/business/ar-ageing", label: "A/R Ageing", module: "sales" },
    { href: "/business/ap-ageing", label: "A/P Ageing", module: "purchases" },
  ] },
];

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { user, entityId, entityName, allowed } = await portalContext();
  const canPostSales = await hasModule(user, entityId, "sales", "edit");
  const canPostPurchases = await hasModule(user, entityId, "purchases", "edit");
  const canEditCatalog = await hasModule(user, entityId, "inventory", "edit");
  const canPostJournal = await hasModule(user, entityId, "journal", "edit");
  const canEditPayroll = await hasModule(user, entityId, "payroll", "edit");
  const groups = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => allowed.has(link.module) && (!link.href.includes("ageing") || allowed.has("reports"))),
  })).filter((group) => group.links.length > 0);

  return (
    <div className="min-h-screen">
      <Topbar user={user} portal />
      <div className="border-b border-[var(--ink-100)] bg-white">
        <nav aria-label="Business portal" className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
          <span className="mr-auto py-2 text-sm font-semibold text-[var(--ink-900)]">{entityName}</span>
          <a href="/business" className="rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">Dashboard</a>
          {(canPostSales || canPostPurchases || canPostJournal) && <details className="group relative">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">Post transaction <span aria-hidden="true">▾</span></summary>
            <div className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-[var(--ink-100)] bg-white p-1 shadow-lg">
              {canPostSales && <a href="/business/invoices/new" className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)]">Invoice</a>}
              {canPostPurchases && <a href="/business/bills/new" className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)]">Bill</a>}
              {canPostJournal && <a href="/business/transactions" className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)]">Transfer, deposit, expense or journal</a>}
            </div>
          </details>}
          {(canPostSales || canPostPurchases || canEditCatalog || canEditPayroll) && <details className="group relative">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">Add new <span aria-hidden="true">▾</span></summary>
            <div className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-[var(--ink-100)] bg-white p-1 shadow-lg">
              {(canPostSales || canPostPurchases) && <a href="/business/contacts" className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)]">Customer or supplier</a>}
              {canEditCatalog && <a href="/business/catalog" className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)]">Product or service</a>}
              {canEditPayroll && <a href="/business/employees" className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)]">Employee</a>}
            </div>
          </details>}
          {groups.map((group) => (
            <details key={group.label} className="group relative">
              <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">
                {group.label} <span aria-hidden="true">▾</span>
              </summary>
              <div className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-[var(--ink-100)] bg-white p-1 shadow-lg">
                {group.links.map((link) => (
                  <a key={link.href} href={link.href} className="block rounded-md px-3 py-2 text-sm text-[var(--ink-800)] hover:bg-[var(--ink-50)] focus-visible:outline-2 focus-visible:outline-[var(--brand-500)]">
                    {link.label}
                  </a>
                ))}
              </div>
            </details>
          ))}
          {user.role === "business_admin" && <a href="/business/settings" className="rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)]">Settings</a>}
          {user.role === "business_admin" && <a href="/business/fx-rates" className="rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)]">FX rates</a>}
          {user.role === "business_admin" && <a href="/business/activity" className="rounded-md px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--ink-50)]">Activity log</a>}
          <span className="w-full text-xs text-[var(--ink-500)] sm:w-auto sm:pl-2">{canPostSales || canPostPurchases || canPostJournal ? "Business owner access" : "Read-only access"}</span>
        </nav>
      </div>
      {children}
    </div>
  );
}
