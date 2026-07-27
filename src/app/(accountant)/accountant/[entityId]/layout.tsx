import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { Wordmark } from "@/components/logo";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";
import { allowedModules, type ModuleKey } from "@/services/permissions";
import { assertFirmSubscription } from "@/lib/guard";
import { IconSignOut } from "@/components/icons";
import { initials } from "@/lib/format";

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: "overview" },
  { section: "Books", module: "coa" },
  { href: "/coa", label: "Chart of Accounts", icon: "book", module: "coa" },
  { href: "/journal", label: "Journal", icon: "journal", module: "journal" },
  { section: "Sales & purchases", module: "sales" },
  { href: "/sales", label: "Invoices", icon: "journal", module: "sales" },
  { href: "/purchases", label: "Bills", icon: "cash", module: "purchases" },
  { href: "/contacts", label: "Customers & suppliers", icon: "building", module: "sales" },
  { section: "Banking", module: "banking" },
  { href: "/banking", label: "Bank feed", icon: "bank", module: "banking" },
  { section: "Payroll", module: "payroll" },
  { href: "/payroll", label: "Pay runs", icon: "cash", module: "payroll" },
  { href: "/payroll/employees", label: "Employees", icon: "building", module: "payroll" },
  { section: "Inventory", module: "inventory" },
  { href: "/inventory", label: "Items & stock", icon: "rows", module: "inventory" },
  { section: "Statements", module: "reports" },
  { href: "/reports/profit-loss", label: "Profit & Loss", icon: "trend", module: "reports" },
  { href: "/reports/comparative-pl", label: "Comparative P&L", icon: "trend", module: "reports" },
  { href: "/reports/balance-sheet", label: "Balance Sheet", icon: "bank", module: "reports" },
  { href: "/reports/cash-flow", label: "Cash Flow", icon: "cash", module: "reports" },
  { href: "/reports/equity-changes", label: "Changes in Equity", icon: "scale", module: "reports" },
  { href: "/reports/trial-balance", label: "Trial Balance", icon: "scale", module: "reports" },
  { href: "/reports/ledger", label: "General Ledger", icon: "rows", module: "reports" },
  { section: "Management reports", module: "reports" },
  { href: "/reports/ar-ageing", label: "AR Ageing", icon: "rows", module: "reports" },
  { href: "/reports/ap-ageing", label: "AP Ageing", icon: "rows", module: "reports" },
  { href: "/reports/tax-summary", label: "Tax Summary", icon: "shield", module: "reports" },
  { href: "/reports/day-book", label: "Day Book", icon: "journal", module: "reports" },
  { section: "Administration", module: "admin" },
  { href: "/mappings", label: "Account mapping", icon: "settings", module: "admin" },
  { href: "/fx-rates", label: "FX rates", icon: "scale", module: "admin" },
  { href: "/periods", label: "Periods", icon: "calendar", module: "periods" },
  { href: "/audit", label: "Audit Trail", icon: "shield", module: "admin" },
];

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const user = await requireAccountant();
  // Commercial gate: suspended/cancelled firms are locked out entirely.
  const subscriptionWarning = await assertFirmSubscription(user);

  try {
    await assertEntityAccess(user, entityId);
  } catch {
    notFound();
  }

  // Only show what this user may actually open — the route layouts and server
  // actions enforce the same permissions, so hiding here is convenience, not
  // the control itself.
  const allowed = await allowedModules(user, entityId);
  const nav = NAV.filter((item) => !item.module || allowed.has(item.module as ModuleKey));

  const entityRows = await db
    .select({ name: entities.name, baseCurrency: entities.baseCurrency })
    .from(entities)
    .where(eq(entities.id, entityId));
  const entity = entityRows[0];
  if (!entity) notFound();

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar sticky top-0 flex h-screen w-[14.75rem] shrink-0 flex-col">
        <div className="px-5 pb-4 pt-5">
          <Wordmark dark />
        </div>

        {/* Entity context */}
        <a
          href="/accountant"
          title="Switch client"
          className="group mx-3 mb-2 block rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 transition-colors duration-150 hover:bg-white/[0.08]"
        >
          <div className="text-[0.625rem] font-semibold uppercase tracking-widest text-[#5f6b7d]">
            Client
          </div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="truncate text-[0.8125rem] font-semibold text-white">{entity.name}</span>
            <span className="ml-2 shrink-0 text-[0.625rem] font-semibold text-[var(--brand-500)]">
              {entity.baseCurrency}
            </span>
          </div>
          <div className="mt-0.5 text-[0.6875rem] text-[#5f6b7d] group-hover:text-[#aeb7c4]">
            Switch client →
          </div>
        </a>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav entityId={entityId} items={nav} />
        </div>

        {/* User */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="avatar">{initials(user.fullName)}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[0.78rem] font-medium text-white">{user.fullName}</div>
              <div className="text-[0.656rem] text-[#5f6b7d]">{user.role.replace(/_/g, " ")}</div>
            </div>
            <form action={logout}>
              <button
                className="rounded-md p-1.5 text-[#5f6b7d] transition-colors duration-150 hover:bg-white/10 hover:text-white"
                title="Sign out"
              >
                <IconSignOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-5xl px-8 py-8">
          {subscriptionWarning && (
            <div className="banner banner-warn mb-4 no-print">
              <span>{subscriptionWarning}</span>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
