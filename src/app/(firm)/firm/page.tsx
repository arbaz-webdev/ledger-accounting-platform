import { requireFirmOwner } from "@/lib/auth";
import { firmOverview, listFirmClients } from "@/services/firms";
import { getFirmSubscription, firmUsage } from "@/services/subscriptions";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { IconBuilding, IconPlus } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  active: "badge-posted",
  trial: "badge-info",
  past_due: "badge-pending",
};

export default async function FirmOverviewPage() {
  const user = await requireFirmOwner();
  const [overview, sub, usage, clients] = await Promise.all([
    firmOverview(user.firmId),
    getFirmSubscription(user.firmId),
    firmUsage(user.firmId),
    listFirmClients(user.firmId),
  ]);

  const limit = (used: number, max: number | null) =>
    max === null ? `${used} / ∞` : `${used} / ${max}`;
  const recent = clients.slice(0, 6);

  return (
    <div className="fade-up">
      <PageHeader title="Firm overview" sub="Your practice at a glance.">
        <a href="/firm/clients" className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          Add client
        </a>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Clients"
          value={limit(usage.entities, usage.maxEntities)}
          hint={usage.entitiesAtLimit ? "plan limit reached" : "active client businesses"}
          accent={usage.entitiesAtLimit ? "negative" : undefined}
        />
        <StatCard
          label="Team"
          value={limit(usage.users, usage.maxUsers)}
          hint={usage.usersAtLimit ? "plan limit reached" : "active logins"}
          accent={usage.usersAtLimit ? "negative" : undefined}
        />
        <StatCard
          label="Posted entries"
          value={String(overview.posted_entries)}
          hint="across all clients"
        />
        <StatCard
          label="Plan"
          value={sub?.plan.name ?? "—"}
          hint={sub ? `${fmtMoney(sub.plan.monthlyPrice)}/mo` : "no subscription"}
          accent="brand"
        />
      </div>

      {sub && (
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className={`badge ${STATUS_BADGE[sub.status] ?? "badge-neutral"}`}>
              <span className="badge-dot" />
              {sub.status.replace(/_/g, " ")}
            </span>
            <span className="text-[0.8125rem] text-[var(--ink-500)]">
              {sub.status === "trial" && sub.trialEndsOn
                ? `Trial ends ${fmtDate(sub.trialEndsOn)}`
                : sub.currentPeriodEnd
                  ? `Current period ends ${fmtDate(sub.currentPeriodEnd)}`
                  : ""}
            </span>
          </div>
          <a href="/firm/subscription" className="btn btn-secondary btn-sm">
            Subscription details
          </a>
        </div>
      )}

      <div className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--ink-100)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">Clients</h2>
          <a href="/firm/clients" className="text-[0.8125rem] text-[var(--brand-700)] hover:underline">
            Manage
          </a>
        </div>
        {clients.length === 0 ? (
          <EmptyState
            icon={<IconBuilding className="h-5 w-5" />}
            title="No clients yet"
            hint="Add your first client business — it arrives with a full chart of accounts, ready to post."
            action={
              <a href="/firm/clients" className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                Add client
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Currency</th>
                <th className="text-right">Entries</th>
                <th className="text-right">Staff</th>
                <th className="text-right">Books</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id} className={c.isActive ? "" : "opacity-55"}>
                  <td className="font-medium text-[var(--ink-800)]">{c.name}</td>
                  <td className="acct">{c.baseCurrency}</td>
                  <td className="td-num">{c.postedEntries}</td>
                  <td className="td-num">{c.assignedUsers}</td>
                  <td className="text-right">
                    {c.isActive ? (
                      <a href={`/accountant/${c.id}`} className="btn btn-ghost btn-sm">
                        Open →
                      </a>
                    ) : (
                      <span className="badge badge-neutral">archived</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
