import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { requireAccountant } from "@/lib/auth";
import { listFirmUsers } from "@/services/users";
import { PageHeader } from "@/components/ui";
import { NewUserForm } from "./new-user-form";
import { toggleUserActiveAction } from "./actions";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform admin",
  firm_admin: "Firm admin",
  firm_owner: "Firm owner",
  accountant_staff: "Accountant staff",
  business_admin: "Business admin",
  business_staff: "Business staff",
  view_only: "View only",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireAccountant();
  if (user.role !== "firm_admin" && user.role !== "firm_owner" && user.role !== "platform_admin") redirect("/accountant");
  const { error } = await searchParams;

  const [firmUsers, firmEntities] = await Promise.all([
    listFirmUsers(user.firmId!),
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.firmId, user.firmId!)),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="fade-up">
        <PageHeader
          title="Users & permissions"
          sub={`${firmUsers.length} users in your firm. Open a user to set which clients and modules they can reach.`}
        >
          <a href="/accountant" className="btn btn-secondary">
            Back to clients
          </a>
        </PageHeader>

        {error && (
          <div className="banner banner-error mb-4" role="alert">
            {error}
          </div>
        )}

        <details className="card mb-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-800)]">
            Add a user
          </summary>
          <div className="mt-4">
            <NewUserForm />
          </div>
        </details>

        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th className="text-right">Clients</th>
                <th className="text-right">Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {firmUsers.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "opacity-55"}>
                  <td>
                    <a
                      href={`/accountant/users/${u.id}`}
                      className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                    >
                      {u.fullName}
                    </a>
                    {u.id === user.id && <span className="badge badge-neutral ml-2">You</span>}
                  </td>
                  <td className="acct">{u.email}</td>
                  <td className="text-[var(--ink-500)]">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="td-num">
                    {u.role === "firm_admin" || u.role === "firm_owner" || u.role === "platform_admin"
                      ? `all (${firmEntities.length})`
                      : u.entityIds.length}
                  </td>
                  <td className="text-right">
                    <span className={`badge ${u.isActive ? "badge-posted" : "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {u.isActive ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="text-right">
                    {u.id !== user.id && (
                      <form action={toggleUserActiveAction} className="inline">
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="makeActive" value={String(!u.isActive)} />
                        <button className="btn btn-ghost btn-sm">
                          {u.isActive ? "Disable" : "Enable"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[0.75rem] text-[var(--ink-400)]">
          Firm admins always have every module for every client of the firm — the matrix applies to
          staff and business users, and the same checks run on every page and every server action.
        </p>
      </div>
    </main>
  );
}
