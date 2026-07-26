import { portalContext } from "@/lib/business-guard";
import { Topbar } from "@/components/topbar";

const LINKS: { href: string; label: string; module: string }[] = [
  { href: "/business", label: "Overview", module: "" },
  { href: "/business/invoices", label: "Invoices", module: "sales" },
  { href: "/business/bills", label: "Bills", module: "purchases" },
  { href: "/business/profit-loss", label: "Profit & Loss", module: "reports" },
  { href: "/business/balance-sheet", label: "Balance Sheet", module: "reports" },
];

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { user, entityName, allowed } = await portalContext();
  const links = LINKS.filter((l) => !l.module || allowed.has(l.module as never));

  return (
    <div className="min-h-screen">
      <Topbar user={user} portal />
      <div className="border-b border-[var(--ink-100)] bg-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 px-6">
          <span className="mr-3 py-3 text-[0.8125rem] font-semibold text-[var(--ink-900)]">
            {entityName}
          </span>
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-[0.8125rem] font-medium text-[var(--ink-500)] transition-colors duration-150 hover:bg-[var(--ink-50)] hover:text-[var(--ink-900)]"
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
