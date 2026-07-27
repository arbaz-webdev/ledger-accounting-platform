import { requirePlatformAdmin } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { Wordmark } from "@/components/logo";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";
import { IconSignOut } from "@/components/icons";
import { initials } from "@/lib/format";

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: "overview" },
  { section: "Customers" },
  { href: "/firms", label: "Firms", icon: "building" },
  { section: "Commercial" },
  { href: "/plans", label: "Plans", icon: "scale" },
];

/** Tier 1 — the software vendor's own console. Not scoped to any firm. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar sticky top-0 flex h-screen w-[14.75rem] shrink-0 flex-col">
        <div className="px-5 pb-4 pt-5">
          <Wordmark dark />
        </div>

        <div className="mx-3 mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div className="text-[0.625rem] font-semibold uppercase tracking-widest text-[#5f6b7d]">
            Console
          </div>
          <div className="mt-0.5 truncate text-[0.8125rem] font-semibold text-white">
            Platform administration
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav items={NAV} basePath="/platform" />
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="avatar">{initials(user.fullName)}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[0.78rem] font-medium text-white">{user.fullName}</div>
              <div className="text-[0.656rem] text-[#5f6b7d]">platform admin</div>
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
        <main className="mx-auto max-w-5xl px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
