import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, userEntityAccess, journalEntries } from "@/db/schema";
import { requireAccountant } from "@/lib/auth";
import { Topbar } from "@/components/topbar";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding, IconArrowRight } from "@/components/icons";

export default async function ClientDashboard() {
  const user = await requireAccountant();

  const cols = { id: entities.id, name: entities.name, baseCurrency: entities.baseCurrency };
  let clients;
  if (user.role === "accountant_staff") {
    // Staff see only explicitly assigned clients
    clients = await db
      .select(cols)
      .from(entities)
      .innerJoin(userEntityAccess, eq(userEntityAccess.entityId, entities.id))
      .where(and(eq(userEntityAccess.userId, user.id), eq(entities.isFirmBooks, false)));
  } else if (user.role === "platform_admin") {
    // Platform admin sees every entity across all firms
    clients = await db.select(cols).from(entities);
  } else {
    // firm_admin sees all clients of their firm
    clients = await db.select(cols).from(entities).where(and(eq(entities.firmId, user.firmId!), eq(entities.isFirmBooks, false)));
  }

  // Posted-entry counts per client for the cards
  const counts = new Map<string, number>();
  if (clients.length > 0) {
    const rows = await db
      .select({
        entityId: journalEntries.entityId,
        n: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .where(eq(journalEntries.status, "posted"))
      .groupBy(journalEntries.entityId);
    for (const r of rows) counts.set(r.entityId, r.n);
  }

  return (
    <div className="min-h-screen">
      <Topbar user={user} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <PageHeader title="Client businesses" sub="Select a client to work on their books.">
          {(user.role === "firm_admin" || user.role === "platform_admin") && (
            <a href="/accountant/users" className="btn btn-secondary">
              Users &amp; permissions
            </a>
          )}
        </PageHeader>

        {clients.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconBuilding className="h-5 w-5" />}
              title="No client businesses yet"
              hint="Clients you create or are assigned to will appear here."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <a key={c.id} href={`/accountant/${c.id}`} className="card card-hover group p-5">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ink-900)] text-[0.8125rem] font-semibold text-[var(--brand-500)]">
                    {c.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")}
                  </div>
                  <IconArrowRight className="h-4 w-4 text-[var(--ink-300)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--brand-600)]" />
                </div>
                <div className="mt-4 font-semibold tracking-tight text-[var(--ink-900)]">
                  {c.name}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ink-500)]">
                  <span className="badge badge-neutral">{c.baseCurrency}</span>
                  <span>{counts.get(c.id) ?? 0} posted entries</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
