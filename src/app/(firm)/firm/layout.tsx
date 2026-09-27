import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { requireFirmOwner } from "@/lib/auth";
import { firmAccessState } from "@/services/subscriptions";
import { logout } from "@/app/login/actions";
import { Wordmark } from "@/components/logo";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";
import { IconSignOut } from "@/components/icons";
import { initials } from "@/lib/format";

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: "overview" },
  { section: "Practice" },
  { href: "/clients", label: "Clients", icon: "building" },
  { href: "/team", label: "Team", icon: "shield" },
  { section: "Account" },
  { href: "/subscription", label: "Subscription", icon: "scale" },
  { href: "/settings", label: "Firm settings", icon: "settings" },
];

/** Tier 2 — the subscribing accounting firm's own console. */
export default async function FirmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireFirmOwner();

  // Same commercial gate as every other portal.
  const access = await firmAccessState(user.firmId);
  if (!access.allowed) redirect("/suspended");

  const [firm] = await db
    .select({ name: firms.name })
    .from(firms)
    .where(eq(firms.id, user.firmId));

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar sticky top-0 flex h-screen w-[14.75rem] shrink-0 flex-col">
        <a href="/security" className="btn btn-ghost">Account security</a>
        <div className="px-5 pb-4 pt-5">
          <Wordmark dark />
        </div>

        <div className="mx-3 mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div className="text-[0.625rem] font-semibold uppercase tracking-widest text-[#5f6b7d]">
            Firm
          </div>
          <div className="mt-0.5 truncate text-[0.8125rem] font-semibold text-white">
            {firm?.name ?? "Your firm"}
          </div>
          <a
            href="/accountant"
            className="mt-1 block text-[0.6875rem] text-[#5f6b7d] transition-colors duration-150 hover:text-[#aeb7c4]"
          >
            Open the books →
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav items={NAV} basePath="/firm" />
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="avatar">{initials(user.fullName)}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[0.78rem] font-medium text-white">{user.fullName}</div>
              <div className="text-[0.656rem] text-[#5f6b7d]">firm owner</div>
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
          {access.warning && (
            <div className="banner banner-warn mb-4">
              <span>{access.warning}</span>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
