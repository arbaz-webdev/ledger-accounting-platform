import { requireFirmOwner } from "@/lib/auth";
import { listFirmClients } from "@/services/firms";
import { firmUsage } from "@/services/subscriptions";
import { fmtDate } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding, IconPlus } from "@/components/icons";
import { NewClientForm } from "./new-client-form";
import { setClientActiveAction } from "../actions";

export default async function FirmClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireFirmOwner();
  const { error } = await searchParams;
  const [clients, usage] = await Promise.all([
    listFirmClients(user.firmId),
    firmUsage(user.firmId),
  ]);

  return (
    <div className="fade-up">
      <PageHeader
        title="Clients"
        sub={`${usage.entities} active${usage.maxEntities === null ? "" : ` of ${usage.maxEntities} allowed`} on your plan`}
      />

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      {usage.entitiesAtLimit && (
        <div className="banner banner-warn mb-4">
          <span>
            You&apos;ve reached your plan limit of {usage.maxEntities} clients. Archive one, or ask
            the platform team to upgrade your plan, to add more.
          </span>
        </div>
      )}

      <details className="card mb-4 p-4" open={clients.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-800)]">
          <IconPlus className="mr-1 inline h-4 w-4" />
          Add a client
        </summary>
        <div className="mt-4">
          <NewClientForm atLimit={usage.entitiesAtLimit} />
        </div>
      </details>

      <div className="card overflow-x-auto">
        {clients.length === 0 ? (
          <EmptyState
            icon={<IconBuilding className="h-5 w-5" />}
            title="No clients yet"
            hint="Each client gets its own isolated ledger, chart of accounts and periods."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Legal name</th>
                <th>Currency</th>
                <th className="text-right">Posted entries</th>
                <th className="text-right">Added</th>
                <th className="text-right">Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className={c.isActive ? "" : "opacity-55"}>
                  <td className="font-medium text-[var(--ink-800)]">{c.name}</td>
                  <td className="text-[var(--ink-500)]">{c.legalName ?? ""}</td>
                  <td className="acct">{c.baseCurrency}</td>
                  <td className="td-num">{c.postedEntries}</td>
                  <td className="td-num whitespace-nowrap">{fmtDate(c.createdAt.toString())}</td>
                  <td className="text-right">
                    <span className={`badge ${c.isActive ? "badge-posted" : "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {c.isActive ? "active" : "archived"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {c.isActive && (
                      <a href={`/accountant/${c.id}`} className="btn btn-ghost btn-sm">
                        Books
                      </a>
                    )}
                    <form action={setClientActiveAction} className="inline">
                      <input type="hidden" name="entityId" value={c.id} />
                      <input type="hidden" name="makeActive" value={String(!c.isActive)} />
                      <button className="btn btn-ghost btn-sm">
                        {c.isActive ? "Archive" : "Restore"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 text-[0.75rem] text-[var(--ink-400)]">
        Archiving a client keeps every journal entry intact and frees a slot on your plan — restore
        it any time.
      </p>
    </div>
  );
}
