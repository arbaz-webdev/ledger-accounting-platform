import { listFirms } from "@/services/firms";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding, IconPlus } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  active: "badge-posted",
  trial: "badge-info",
  past_due: "badge-pending",
  suspended: "badge-voided",
  cancelled: "badge-neutral",
};

export default async function FirmsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const firms = await listFirms();
  const mrr = firms
    .filter((f) => f.isActive && (f.status === "active" || f.status === "past_due"))
    .reduce((s, f) => s + Number(f.monthlyPrice ?? 0), 0);

  return (
    <div className="fade-up">
      <PageHeader
        title="Firms"
        sub={`${firms.length} subscribing firms · ${fmtMoney(mrr)}/mo recurring`}
      >
        <a href="/platform/firms/new" className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New firm
        </a>
      </PageHeader>

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="card overflow-x-auto">
        {firms.length === 0 ? (
          <EmptyState
            icon={<IconBuilding className="h-5 w-5" />}
            title="No firms yet"
            hint="Provisioning a firm creates the firm, its owner login and its subscription together."
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
                <th>Contact</th>
                <th>Plan</th>
                <th className="text-right">Clients</th>
                <th className="text-right">Users</th>
                <th className="text-right">Joined</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => (
                <tr key={f.id} className={`tbl-row-link ${f.isActive ? "" : "opacity-55"}`}>
                  <td>
                    <a
                      href={`/platform/firms/${f.id}`}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {f.name}
                    </a>
                  </td>
                  <td className="acct text-[0.75rem]">{f.contactEmail ?? ""}</td>
                  <td className="text-[var(--ink-500)]">
                    {f.planName ?? "—"}
                    {f.monthlyPrice && (
                      <span className="num ml-1 text-[0.75rem] text-[var(--ink-400)]">
                        {fmtMoney(f.monthlyPrice)}
                      </span>
                    )}
                  </td>
                  <td className="td-num">{f.entityCount}</td>
                  <td className="td-num">{f.userCount}</td>
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
    </div>
  );
}
