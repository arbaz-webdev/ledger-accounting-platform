import { requireFirmOwner } from "@/lib/auth";
import { getFirmSubscription, firmUsage } from "@/services/subscriptions";
import { listPlans } from "@/services/plans";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui";

const STATUS_BADGE: Record<string, string> = {
  active: "badge-posted",
  trial: "badge-info",
  past_due: "badge-pending",
  suspended: "badge-voided",
  cancelled: "badge-neutral",
};

/** Read-only: only the platform can change what a firm is subscribed to. */
export default async function FirmSubscriptionPage() {
  const user = await requireFirmOwner();
  const [sub, usage, plans] = await Promise.all([
    getFirmSubscription(user.firmId),
    firmUsage(user.firmId),
    listPlans({ activeOnly: true }),
  ]);

  const pct = (used: number, max: number | null) =>
    max === null ? 0 : Math.min(100, Math.round((used / max) * 100));

  return (
    <div className="fade-up">
      <PageHeader title="Subscription" sub="Your plan, and how much of it you're using." />

      {!sub ? (
        <div className="banner banner-warn">
          <span>No subscription is attached to your firm. Contact the platform team.</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Plan"
              value={sub.plan.name}
              hint={`${fmtMoney(sub.plan.monthlyPrice)} ${sub.plan.currency}/month`}
              accent="brand"
            />
            <StatCard
              label="Clients used"
              value={`${usage.entities} / ${usage.maxEntities ?? "∞"}`}
              hint={usage.maxEntities === null ? "unlimited" : `${pct(usage.entities, usage.maxEntities)}% of your allowance`}
              accent={usage.entitiesAtLimit ? "negative" : undefined}
            />
            <StatCard
              label="Users used"
              value={`${usage.users} / ${usage.maxUsers ?? "∞"}`}
              hint={usage.maxUsers === null ? "unlimited" : `${pct(usage.users, usage.maxUsers)}% of your allowance`}
              accent={usage.usersAtLimit ? "negative" : undefined}
            />
          </div>

          <div className="card mt-4 overflow-hidden">
            <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Details</h2>
            </div>
            <table className="tbl">
              <tbody>
                <tr>
                  <td className="w-56 text-[var(--ink-500)]">Status</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[sub.status] ?? "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {sub.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="text-[var(--ink-500)]">Started</td>
                  <td className="font-medium text-[var(--ink-800)]">{fmtDate(sub.startedOn)}</td>
                </tr>
                {sub.trialEndsOn && (
                  <tr>
                    <td className="text-[var(--ink-500)]">Trial ends</td>
                    <td className="font-medium text-[var(--ink-800)]">{fmtDate(sub.trialEndsOn)}</td>
                  </tr>
                )}
                {sub.currentPeriodEnd && (
                  <tr>
                    <td className="text-[var(--ink-500)]">Current period ends</td>
                    <td className="font-medium text-[var(--ink-800)]">
                      {fmtDate(sub.currentPeriodEnd)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card mt-4 overflow-hidden">
            <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Available plans</h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="text-right">Price / month</th>
                  <th className="text-right">Clients</th>
                  <th className="text-right">Users</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className={p.id === sub.plan.id ? "bg-[var(--ink-50)]" : ""}>
                    <td className="font-medium text-[var(--ink-800)]">
                      {p.name}
                      {p.description && (
                        <span className="block text-[0.75rem] font-normal text-[var(--ink-400)]">
                          {p.description}
                        </span>
                      )}
                    </td>
                    <td className="td-num">{fmtMoney(p.monthlyPrice)}</td>
                    <td className="td-num">{p.maxEntities ?? "∞"}</td>
                    <td className="td-num">{p.maxUsers ?? "∞"}</td>
                    <td className="text-right">
                      {p.id === sub.plan.id && (
                        <span className="badge badge-posted">
                          <span className="badge-dot" />
                          current
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-[var(--ink-100)] px-5 py-2.5 text-[0.75rem] text-[var(--ink-400)]">
              To change plan, contact the platform team — they manage subscriptions centrally.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
