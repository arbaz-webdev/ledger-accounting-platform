import { requireFirmOwner } from "@/lib/auth";
import { listFirmUsers, getFirmUser } from "@/services/users";
import { listFirmClients } from "@/services/firms";
import { listFirmTeams, listTeamMemberships } from "@/services/firm-teams";
import { firmUsage } from "@/services/subscriptions";
import { ROLE_LABEL } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { NewMemberForm } from "./new-member-form";
import { setTeamMemberActiveAction, grantClientAccessAction, revokeClientAccessAction } from "../actions";
import { createTeamAction, renameTeamAction, deleteTeamAction, assignTeamAction, deleteMemberAction } from "./actions";

const PORTAL_ROLES = new Set(["business_admin", "business_staff", "view_only"]);

export default async function FirmTeamPage({ searchParams }: { searchParams: Promise<{ error?: string; user?: string }> }) {
  const owner = await requireFirmOwner();
  const query = await searchParams;
  const [members, clients, usage, teams, memberships] = await Promise.all([
    listFirmUsers(owner.firmId), listFirmClients(owner.firmId), firmUsage(owner.firmId),
    listFirmTeams(owner.firmId), listTeamMemberships(owner.firmId),
  ]);
  const selected = members.find(m => m.id === query.user) ?? members[0];
  const detail = selected ? await getFirmUser(selected.id, owner.firmId) : null;
  const clientsById = new Map(clients.map(c => [c.id, c.name]));
  const activeClients = clients.filter(c => c.isActive);
  const assignedTeam = selected ? memberships.get(selected.id) ?? "" : "";
  const needsGrants = selected && (selected.role === "accountant_staff" || PORTAL_ROLES.has(selected.role));
  const ungranted = selected ? activeClients.filter(c => !selected.entityIds.includes(c.id)) : [];
  const groups = [...teams.map(team => ({ id: team.id, name: team.name, members: members.filter(m => memberships.get(m.id) === team.id), entries: team.posted_entries })),
    { id: "unassigned", name: "Unassigned", members: members.filter(m => !memberships.has(m.id)), entries: 0 }];

  return <div className="fade-up">
    <PageHeader title="Team" sub={`${usage.users} active${usage.maxUsers === null ? "" : ` of ${usage.maxUsers} allowed`} on your plan`} />
    {query.error && <div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    {usage.usersAtLimit && <div className="banner banner-warn mb-4">Your plan user limit is reached. Disable an account or change the plan before adding another.</div>}
    <div className="mb-4 flex flex-wrap gap-2">
      <details className="relative"><summary className="btn btn-primary btn-sm cursor-pointer list-none"><IconPlus className="h-4 w-4" /> Add user</summary><div className="card absolute left-0 z-10 mt-2 w-[min(90vw,28rem)] p-4 shadow-lg"><NewMemberForm atLimit={usage.usersAtLimit} /></div></details>
      <details className="relative"><summary className="btn btn-secondary btn-sm cursor-pointer list-none">Create team</summary><form action={createTeamAction} className="card absolute left-0 z-10 mt-2 flex w-72 gap-2 p-4 shadow-lg"><input name="name" required maxLength={100} placeholder="Team name" className="input min-w-0" /><button className="btn btn-brand btn-sm">Add</button></form></details>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,1.8fr)]">
      <section className="card overflow-hidden" aria-label="Team member list">
        {groups.map(group => <div key={group.id} className="border-b border-[var(--ink-100)] last:border-0">
          <div className="flex items-center justify-between bg-[var(--ink-50)] px-4 py-2 text-sm font-semibold"><span>{group.name} <span className="text-[var(--ink-400)]">({group.members.length})</span></span>{group.id !== "unassigned" && <span className="text-xs font-normal text-[var(--ink-500)]">{group.entries} posted entries</span>}</div>
          {group.members.length ? group.members.map(member => <a key={member.id} href={`/firm/team?user=${member.id}`} className={`block border-l-2 px-4 py-2.5 text-sm hover:bg-[var(--ink-50)] ${selected?.id === member.id ? "border-[var(--brand-500)] bg-[var(--brand-50)]" : "border-transparent"}`}><span className="font-medium">{member.fullName}</span><span className="ml-2 text-xs text-[var(--ink-500)]">{ROLE_LABEL[member.role] ?? member.role}</span>{!member.isActive && <span className="ml-2 badge badge-neutral">disabled</span>}</a>) : <p className="px-4 py-2 text-xs text-[var(--ink-400)]">No members</p>}
        </div>)}
      </section>
      {selected && detail ? <section className="card space-y-5 p-5" aria-label="Teammate details">
        <div><h2 className="text-lg font-semibold">{selected.fullName}</h2><p className="text-sm text-[var(--ink-500)]">{selected.email} · {ROLE_LABEL[selected.role] ?? selected.role}</p><span className={`badge mt-2 ${selected.isActive ? "badge-posted" : "badge-neutral"}`}>{selected.isActive ? "Active" : "Disabled"}</span></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><div className="field-label">Access level</div><p className="text-sm">{ROLE_LABEL[selected.role] ?? selected.role}</p></div><div><div className="field-label">Team</div><form action={assignTeamAction} className="flex gap-2"><input type="hidden" name="userId" value={selected.id} /><select className="select min-w-0" name="teamId" defaultValue={assignedTeam}><option value="">Unassigned</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button className="btn btn-secondary btn-sm">Save</button></form></div></div>
        <div className="border-t border-[var(--ink-100)] pt-4"><h3 className="mb-2 text-sm font-semibold">Assigned clients and permissions</h3>
          {needsGrants ? <><div className="space-y-2">{detail.access.length ? detail.access.map(a => <div key={a.entityId} className="rounded-md border border-[var(--ink-100)] p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{a.entityName}</span><form action={revokeClientAccessAction}><input type="hidden" name="userId" value={selected.id} /><input type="hidden" name="entityId" value={a.entityId} /><button className="btn btn-ghost btn-sm">Remove access</button></form></div><p className="mt-1 text-xs text-[var(--ink-500)]">{Object.entries(a.permissions as Record<string, unknown>).filter(([,v]) => Boolean(v)).map(([k,v]) => `${k}: ${v === true ? "view" : String(v)}`).join(" · ") || "No modules enabled"}</p></div>) : <p className="text-sm text-[var(--ink-500)]">No clients assigned.</p>}</div>
            {ungranted.length > 0 && <form action={grantClientAccessAction} className="mt-3 flex gap-2"><input type="hidden" name="userId" value={selected.id} /><select name="entityId" className="select min-w-0">{ungranted.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="btn btn-secondary btn-sm">Grant access</button></form>}
          </> : <p className="text-sm text-[var(--ink-500)]">This role can open every client in the firm. Module controls are managed inside client books.</p>}
        </div>
        <div className="border-t border-[var(--ink-100)] pt-4"><h3 className="text-sm font-semibold">Login details</h3><p className="mt-1 text-sm text-[var(--ink-500)]">Email: {selected.email}. Passwords are never displayed.</p></div>
        {selected.id !== owner.id && <div className="flex flex-wrap gap-2 border-t border-[var(--ink-100)] pt-4"><form action={setTeamMemberActiveAction}><input type="hidden" name="userId" value={selected.id} /><input type="hidden" name="makeActive" value={String(!selected.isActive)} /><button className="btn btn-secondary btn-sm">{selected.isActive ? "Disable user" : "Enable user"}</button></form><details><summary className="btn btn-ghost btn-sm cursor-pointer list-none">Delete user</summary><form action={deleteMemberAction} className="mt-2 space-y-2 rounded-md border border-[var(--negative)] p-3"><p className="text-xs text-[var(--ink-500)]">Only unused users can be deleted. Enter the exact email to confirm. Users with accounting or audit history must be disabled instead.</p><input type="hidden" name="userId" value={selected.id} /><input name="confirmEmail" type="email" required placeholder={selected.email} className="input" /><button className="btn btn-danger btn-sm">Delete</button></form></details></div>}
      </section> : <div className="card p-5 text-sm text-[var(--ink-500)]">Add a user to build your team.</div>}
    </div>
    {teams.length > 0 && <details className="card mt-4 p-4"><summary className="cursor-pointer text-sm font-semibold">Manage teams</summary><div className="mt-3 space-y-3">{teams.map(team => <div key={team.id} className="flex flex-wrap items-center gap-2"><form action={renameTeamAction} className="flex flex-1 gap-2"><input type="hidden" name="teamId" value={team.id} /><input name="name" defaultValue={team.name} required maxLength={100} className="input min-w-0" /><button className="btn btn-secondary btn-sm">Rename</button></form><form action={deleteTeamAction}><input type="hidden" name="teamId" value={team.id} /><button className="btn btn-ghost btn-sm">Delete team</button></form></div>)}</div><p className="mt-3 text-xs text-[var(--ink-500)]">Deleting a team leaves its users unassigned; it does not remove their accounts.</p></details>}
    <p className="mt-3 text-xs text-[var(--ink-500)]">Posted entries count records created by current team members across this firm&apos;s clients. No quality score is inferred.</p>
  </div>;
}
