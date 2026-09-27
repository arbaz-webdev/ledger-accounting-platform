import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { requireAccountant } from "@/lib/auth";
import { getFirmUser } from "@/services/users";
import { MODULE_DEFS, roleAllows, type ModuleKey } from "@/services/permissions";
import { PageHeader } from "@/components/ui";
import { grantAccessAction, revokeAccessAction, savePermissionsAction } from "../actions";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform admin",
  firm_admin: "Firm admin",
  firm_owner: "Firm owner",
  accountant_staff: "Accountant staff",
  business_admin: "Business admin",
  business_staff: "Business staff",
  view_only: "View only",
};

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireAccountant();
  if (actor.role !== "firm_admin" && actor.role !== "firm_owner" && actor.role !== "platform_admin") redirect("/accountant");
  const { userId } = await params;
  const { error } = await searchParams;

  const data = await getFirmUser(userId, actor.firmId!);
  if (!data) notFound();
  const { user, access } = data;

  const firmEntities = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.firmId, actor.firmId!));

  const isAdmin = user.role === "firm_admin" || user.role === "firm_owner" || user.role === "platform_admin";
  const grantedIds = new Set(access.map((a) => a.entityId));
  const ungranted = firmEntities.filter((e) => !grantedIds.has(e.id));
  const applicableModules = MODULE_DEFS.filter((d) => roleAllows(user.role, d.key as ModuleKey));

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="fade-up">
        <PageHeader title={user.fullName} sub={`${user.email} · ${ROLE_LABELS[user.role]}`}>
          <a href="/accountant/users" className="btn btn-secondary">
            All users
          </a>
        </PageHeader>

        {error && (
          <div className="banner banner-error mb-4" role="alert">
            {error}
          </div>
        )}

        {isAdmin ? (
          <div className="banner banner-ok mb-4">
            <span>
              Firm admins have every module for every client of the firm — there is nothing to
              configure here.
            </span>
          </div>
        ) : (
          <>
            {ungranted.length > 0 && (
              <form action={grantAccessAction} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
                <input type="hidden" name="userId" value={user.id} />
                <div className="min-w-56 flex-1">
                  <label className="field-label">Grant access to a client</label>
                  <select name="entityId" className="select">
                    {ungranted.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary">Grant access</button>
              </form>
            )}

            {access.length === 0 ? (
              <div className="card p-6 text-center text-[0.8125rem] text-[var(--ink-500)]">
                This user has no client access yet.
              </div>
            ) : (
              <div className="space-y-4">
                {access.map((a) => {
                  const perms = (a.permissions ?? {}) as import("@/services/permissions").EntityPermissions;
                  return (
                    <form
                      key={a.entityId}
                      action={savePermissionsAction}
                      className="card overflow-hidden"
                    >
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="entityId" value={a.entityId} />
                      <input type="hidden" name="targetRole" value={user.role} />

                      <div className="flex items-center justify-between border-b border-[var(--ink-100)] px-5 py-3.5">
                        <h2 className="text-sm font-semibold text-[var(--ink-900)]">{a.entityName}</h2>
                        <span className="text-[0.75rem] text-[var(--ink-400)]">
                          {applicableModules.filter((d) => perms[d.key]).length} of{" "}
                          {applicableModules.length} modules
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-x-6 gap-y-2 p-5 sm:grid-cols-2">
                        {applicableModules.map((def) => (
                          <label
                            key={def.key}
                            className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 transition-colors duration-150 hover:bg-[var(--ink-50)]"
                          >
                            <select name={`perm_${def.key}`} className="select max-w-28" aria-label={`${def.label} capability`}
                              defaultValue={perms[def.key] === true ? (user.role === "accountant_staff" ? "edit" : "view") : typeof perms[def.key] === "string" ? String(perms[def.key]) : "none"}>
                              <option value="none">No access</option><option value="view">View</option>
                              {user.role === "accountant_staff" && <option value="edit">Edit / post</option>}
                            </select>
                            <span className="min-w-0">
                              <span className="block text-[0.8125rem] font-medium text-[var(--ink-800)]">
                                {def.label}
                              </span>
                              <span className="block text-[0.6875rem] leading-snug text-[var(--ink-400)]">
                                {def.hint}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>

                      <div className="flex items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-5 py-3">
                        <button className="btn btn-brand btn-sm">Save permissions</button>
                        <button
                          formAction={revokeAccessAction}
                          className="btn btn-ghost btn-sm text-[var(--negative)]"
                        >
                          Revoke access to this client
                        </button>
                      </div>
                    </form>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
