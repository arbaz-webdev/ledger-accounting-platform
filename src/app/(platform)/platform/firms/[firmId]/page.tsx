import { notFound } from "next/navigation";
import { getFirm } from "@/services/firms";
import { getFirmSubscription, firmUsage } from "@/services/subscriptions";
import { listPlans } from "@/services/plans";
import { ROLE_LABEL } from "@/lib/roles";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui";
import { setFirmActiveAction, setSubscriptionAction } from "../../actions";

const STATUS_BADGE: Record<string, string> = {
  active: "badge-posted",
  trial: "badge-info",
  past_due: "badge-pending",
  suspended: "badge-voided",
  cancelled: "badge-neutral",
};

const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;

export default async function FirmDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { firmId } = await params;
  const { error } = await searchParams;

  const data = await getFirm(firmId);
  if (!data) notFound();
  const { firm, users: firmUsers, entities: firmEntities } = data;

  const [sub, usage, plans] = await Promise.all([
    getFirmSubscription(firmId),
    firmUsage(firmId),
    listPlans({ activeOnly: true }),
  ]);

  const limit = (used: number, max: number | null) =>
    max === null ? `${used} / unlimited` : `${used} / ${max}`;

  return (
    <div className="fade-up">
      <PageHeader
        title={firm.name}
        sub={`${firm.legalName ?? "—"} · joined ${fmtDate(firm.createdAt.toString())}`}
      >
        <a href="/platform/firms" className="btn btn-secondary">
          All firms
        </a>
        <form action={setFirmActiveAction}>
          <input type="hidden" name="firmId" value={firm.id} />
          <input type="hidden" name="makeActive" value={String(!firm.isActive)} />
          <button className={firm.isActive ? "btn btn-danger" : "btn btn-brand"}>
            {firm.isActive ? "Deactivate firm" : "Reactivate firm"}
          </button>
        </form>
      </PageHeader>

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      {!firm.isActive && (
        <div className="banner banner-warn mb-4">
          <span>
            This firm is deactivated — every one of its users is locked out until it&apos;s
            reactivated. Their data is untouched.
          </span>
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard
          label="Subscription"
          value={sub ? sub.plan.name : "None"}
          hint={sub ? `${fmtMoney(sub.plan.monthlyPrice)}/mo` : "no plan attached"}
          accent={sub?.status === "active" ? "brand" : undefined}
        />
        <StatCard label="Clients" value={limit(usage.entities, usage.maxEntities)} hint="active client businesses" />
        <StatCard label="Users" value={limit(usage.users, usage.maxUsers)} hint="active logins" />
        <StatCard
          label="Status"
          value={sub ? sub.status.replace(/_/g, " ") : "—"}
          hint={sub?.currentPeriodEnd ? `renews ${fmtDate(sub.currentPeriodEnd)}` : ""}
          accent={sub && ["suspended", "cancelled"].includes(sub.status) ? "negative" : undefined}
        />
      </div>

      {(usage.entitiesAtLimit || usage.usersAtLimit) && (
        <div className="banner banner-warn mb-4">
          <span>
            This firm has hit its plan limit
            {usage.entitiesAtLimit && usage.usersAtLimit
              ? "s for both clients and users"
              : usage.entitiesAtLimit
                ? " for clients"
                : " for users"}
            . They can&apos;t add more until the plan is upgraded.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                Client businesses ({firmEntities.length})
              </h2>
            </div>
            {firmEntities.length === 0 ? (
              <p className="px-5 py-6 text-center text-[0.8125rem] text-[var(--ink-400)]">
                The firm hasn&apos;t added any clients yet.
              </p>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Currency</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {firmEntities.map((e) => (
                    <tr key={e.id} className={e.isActive ? "" : "opacity-55"}>
                      <td className="font-medium text-[var(--ink-800)]">{e.name}</td>
                      <td className="acct">{e.baseCurrency}</td>
                      <td className="text-right">
                        <span className={`badge ${e.isActive ? "badge-posted" : "badge-neutral"}`}>
                          <span className="badge-dot" />
                          {e.isActive ? "active" : "archived"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                Users ({firmUsers.length})
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {firmUsers.map((u) => (
                  <tr key={u.id} className={u.isActive ? "" : "opacity-55"}>
                    <td className="font-medium text-[var(--ink-800)]">{u.fullName}</td>
                    <td className="acct text-[0.75rem]">{u.email}</td>
                    <td className="text-[var(--ink-500)]">{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className="text-right">
                      <span className={`badge ${u.isActive ? "badge-posted" : "badge-neutral"}`}>
                        <span className="badge-dot" />
                        {u.isActive ? "active" : "disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form action={setSubscriptionAction} className="card h-fit p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink-900)]">Subscription</h2>
          <input type="hidden" name="firmId" value={firm.id} />

          <div className="space-y-3">
            <div>
              <label className="field-label">Plan</label>
              <select name="planId" className="select" defaultValue={sub?.plan.id ?? ""}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {fmtMoney(p.monthlyPrice)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Status</label>
              <select name="status" className="select" defaultValue={sub?.status ?? "trial"}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Trial ends</label>
              <input
                type="date"
                name="trialEndsOn"
                defaultValue={sub?.trialEndsOn ?? ""}
                className="input"
              />
            </div>
            <div>
              <label className="field-label">Period ends</label>
              <input
                type="date"
                name="currentPeriodEnd"
                defaultValue={sub?.currentPeriodEnd ?? todayIso()}
                className="input"
              />
            </div>
            <div>
              <label className="field-label">Notes</label>
              <input name="notes" defaultValue={sub?.notes ?? ""} placeholder="Optional" className="input" />
            </div>
            <button className="btn btn-brand w-full">Save subscription</button>
            <p className="text-[0.6875rem] leading-snug text-[var(--ink-400)]">
              <strong>suspended</strong> and <strong>cancelled</strong> lock every user of this firm
              out immediately. <strong>past_due</strong> lets them in with a warning.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
