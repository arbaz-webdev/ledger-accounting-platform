import { logout } from "@/app/login/actions";
import { Wordmark } from "@/components/logo";
import { IconSignOut } from "@/components/icons";
import { initials } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform admin",
  firm_admin: "Firm admin",
  accountant_staff: "Accountant",
  business_admin: "Business admin",
  business_staff: "Business staff",
  view_only: "View only",
};

export function Topbar({ user, portal }: { user: SessionUser; portal?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--ink-200)] bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a href={portal ? "/business" : "/accountant"} className="flex items-center gap-3">
          <Wordmark />
          <span className={`badge ${portal ? "badge-info" : "badge-posted"}`}>
            {portal ? "Business portal" : "Accountant"}
          </span>
        </a>
        <div className="flex items-center gap-3">
          <a href="/security" className="btn btn-ghost btn-sm">Security</a>
          <div className="hidden items-center gap-2.5 sm:flex">
            <span className="avatar">{initials(user.fullName)}</span>
            <div className="leading-tight">
              <div className="text-[0.8125rem] font-medium text-[var(--ink-800)]">{user.fullName}</div>
              <div className="text-[0.6875rem] text-[var(--ink-400)]">
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
          </div>
          <form action={logout}>
            <button className="btn btn-ghost btn-sm" title="Sign out">
              <IconSignOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
