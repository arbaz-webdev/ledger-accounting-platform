import { requireFirmOwner } from "@/lib/auth";
import { listFirmUsers } from "@/services/users";
import { listFirmClients } from "@/services/firms";
import { firmUsage } from "@/services/subscriptions";
import { ROLE_LABEL } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { NewMemberForm } from "./new-member-form";
import {
  setTeamMemberActiveAction,
  grantClientAccessAction,
  revokeClientAccessAction,
} from "../actions";

/** Roles that work in the books vs. roles that use the client portal. */
const PORTAL_ROLES = new Set(["business_admin", "business_staff", "view_only"]);

export default async function FirmTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireFirmOwner();
  const { error } = await searchParams;

  const [members, clients, usage] = await Promise.all([
    listFirmUsers(user.firmId),
    listFirmClients(user.firmId),
    firmUsage(user.firmId),
  ]);
  const activeClients = clients.filter((c) => c.isActive);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="fade-up">
      <PageHeader
        title="Team"
        sub={`${usage.users} active${usage.maxUsers === null ? "" : ` of ${usage.maxUsers} allowed`} on your plan`}
      />

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      {usage.usersAtLimit && (
        <div className="banner banner-warn mb-4">
          <span>
            You&apos;ve reached your plan limit of {usage.maxUsers} users. Disable one, or ask the
            platform team to upgrade your plan, to add more.
          </span>
        </div>
      )}

      <details className="card mb-4 p-4" open={members.length <= 1}>
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-800)]">
          <IconPlus className="mr-1 inline h-4 w-4" />
          Add a user
        </summary>
        <div className="mt-4">
          <NewMemberForm atLimit={usage.usersAtLimit} />
        </div>
      </details>

      <div className="space-y-3">
        {members.map((m) => {
          const isPortalUser = PORTAL_ROLES.has(m.role);
          const granted = m.entityIds;
          const ungranted = activeClients.filter((c) => !granted.includes(c.id));
          const isSelf = m.id === user.id;
          // Firm owners and admins reach every client by role, so per-client
          // grants only mean something for staff and portal users.
          const needsGrants = m.role === "accountant_staff" || isPortalUser;

          return (
            <div key={m.id} className={`card p-4 ${m.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--ink-900)]">
                      {m.fullName}
                    </span>
                    {isSelf && <span className="badge badge-neutral">You</span>}
                    <span className={`badge ${m.isActive ? "badge-posted" : "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {m.isActive ? "active" : "disabled"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[0.8125rem] text-[var(--ink-500)]">
                    <span className="acct">{m.email}</span> · {ROLE_LABEL[m.role] ?? m.role}
                    {isPortalUser && " · client portal"}
                  </div>
                </div>
                {!isSelf && (
                  <form action={setTeamMemberActiveAction}>
                    <input type="hidden" name="userId" value={m.id} />
                    <input type="hidden" name="makeActive" value={String(!m.isActive)} />
                    <button className="btn btn-ghost btn-sm">
                      {m.isActive ? "Disable" : "Enable"}
                    </button>
                  </form>
                )}
              </div>

              {needsGrants ? (
                <div className="mt-3 border-t border-[var(--ink-100)] pt-3">
                  <div className="field-label mb-1.5">Client access</div>
                  {granted.length === 0 ? (
                    <p className="text-[0.8125rem] text-[var(--ink-400)]">
                      No clients assigned yet — this user can&apos;t see anything.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {granted.map((id) => (
                        <form key={id} action={revokeClientAccessAction} className="inline">
                          <input type="hidden" name="userId" value={m.id} />
                          <input type="hidden" name="entityId" value={id} />
                          <button
                            className="badge badge-info transition-colors duration-150 hover:bg-[var(--negative-bg)] hover:text-[var(--negative)]"
                            title="Remove access"
                          >
                            {clientName.get(id) ?? id.slice(0, 8)} ×
                          </button>
                        </form>
                      ))}
                    </div>
                  )}

                  {ungranted.length > 0 && (
                    <form action={grantClientAccessAction} className="mt-2.5 flex items-end gap-2">
                      <input type="hidden" name="userId" value={m.id} />
                      <select name="entityId" className="select input-cell max-w-64">
                        {ungranted.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-secondary btn-sm">Grant access</button>
                    </form>
                  )}
                </div>
              ) : (
                <p className="mt-3 border-t border-[var(--ink-100)] pt-3 text-[0.75rem] text-[var(--ink-400)]">
                  {ROLE_LABEL[m.role]}s reach every client of the firm by role — no per-client
                  grants needed.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[0.75rem] text-[var(--ink-400)]">
        Fine-grained module permissions (who may touch payroll, run the close, etc.) live in the
        books under Administration → Users.
      </p>
    </div>
  );
}
