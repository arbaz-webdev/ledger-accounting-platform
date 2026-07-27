import { platformSummary } from "@/services/subscriptions";
import { listFirms } from "@/services/firms";
import { listPlans } from "@/services/plans";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { IconBuilding, IconPlus } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  active: "badge-posted",
  trial: "badge-info",
  past_due: "badge-pending",
  suspended: "badge-voided",
  cancelled: "badge-neutral",
};

export default async function PlatformOverviewPage() {
  const [summary, firms, plans] = await Promise.all([
    platformSummary(),
    listFirms(),
    listPlans({ activeOnly: true }),
  ]);

  const totalClients = firms.reduce((s, f) => s + f.entityCount, 0);
  const totalUsers = firms.reduce((s, f) => s + f.userCount, 0);
  const recent = firms.slice(0, 6);

  return (
    <div className="fade-up">
      <PageHeader
        title="Platform overview"
        sub="Every firm subscribing to the platform, and what they're worth."
      >
        <a href="/platform/firms/new" className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New firm
        </a>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly recurring revenue"
          value={fmtMoney(summary.mrr)}
          hint={`${summary.currency} · paying firms only`}
          accent="brand"
        />
        <StatCard
          label="Firms"
          value={String(summary.totalFirms)}
          hint={`${summary.activeFirms} active · ${summary.trialFirms} trial`}
        />
        <StatCard label="Client businesses" value={String(totalClients)} hint="across all firms" />
        <StatCard label="Users" value={String(totalUsers)} hint="all tiers" />
      </div>

      {(summary.pastDueFirms > 0 || summary.suspendedFirms > 0) && (
        <div className="banner banner-warn mt-4">
          <span>
            {summary.pastDueFirms > 0 && `${summary.pastDueFirms} firm(s) past due. `}
            {summary.suspendedFirms > 0 && `${summary.suspendedFirms} firm(s) suspended.`}
          </span>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Recent firms</h2>
            <a href="/platform/firms" className="text-[0.8125rem] text-[var(--brand-700)] hover:underline">
              View all
            </a>
          </div>
          {firms.length === 0 ? (
            <EmptyState
              icon={<IconBuilding className="h-5 w-5" />}
              title="No firms yet"
              hint="Provision your first subscribing firm — it creates their owner login and subscription in one step."
              action={
                <a href="/platform/firms/new" className="btn btn-secondary btn-sm">
                  <IconPlus className="h-3.5 w-3.5" />
                  New firm
                </a>
              }
            />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Firm</th>
                  <th>Plan</th>
                  <th className="text-right">Clients</th>
                  <th className="text-right">Joined</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((f) => (
                  <tr key={f.id} className="tbl-row-link">
                    <td>
                      <a
                        href={`/platform/firms/${f.id}`}
                        className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                      >
                        {f.name}
                      </a>
                    </td>
                    <td className="text-[var(--ink-500)]">{f.planName ?? "—"}</td>
                    <td className="td-num">{f.entityCount}</td>
                    <td className="td-num whitespace-nowrap">{fmtDate(f.createdAt.toString())}</td>
                    <td className="text-right">
                      <span
                        className={`badge ${!f.isActive ? "badge-voided" : (STATUS_BADGE[f.status ?? ""] ?? "badge-neutral")}`}
                      >
                        <span className="badge-dot" />
                        {!f.isActive ? "deactivated" : (f.status?.replace(/_/g, " ") ?? "no plan")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card h-fit overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Plans</h2>
          </div>
          <ul className="divide-y divide-[var(--ink-100)]">
            {plans.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between px-5 py-2.5">
                <span className="text-[0.8125rem] font-medium text-[var(--ink-800)]">{p.name}</span>
                <span className="num text-[0.8125rem] text-[var(--ink-600)]">
                  {fmtMoney(p.monthlyPrice)}/mo
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-[var(--ink-100)] px-5 py-3">
            <a href="/platform/plans" className="text-[0.8125rem] text-[var(--brand-700)] hover:underline">
              Manage plans →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
