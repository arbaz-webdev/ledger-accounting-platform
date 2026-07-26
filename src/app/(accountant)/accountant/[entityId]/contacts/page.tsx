import { listContacts } from "@/services/contacts";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding, IconPlus } from "@/components/icons";
import { createCustomerAction, toggleContactAction } from "../sales/actions";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId } = await params;
  const { error } = await searchParams;
  const contacts = await listContacts(entityId);

  const customers = contacts.filter((c) => c.type === "customer");
  const suppliers = contacts.filter((c) => c.type === "supplier");

  const table = (rows: typeof contacts, label: string) => (
    <div className="card overflow-x-auto">
      <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
        <h2 className="text-sm font-semibold text-[var(--ink-900)]">
          {label} <span className="ml-1 text-[var(--ink-400)]">({rows.length})</span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<IconBuilding className="h-5 w-5" />}
          title={`No ${label.toLowerCase()} yet`}
          hint="Add one using the form above."
        />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th className="text-right">Terms</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={`tbl-row-link ${c.isActive ? "" : "opacity-55"}`}>
                <td className="font-medium text-[var(--ink-800)]">{c.name}</td>
                <td className="text-[var(--ink-500)]">{c.email ?? ""}</td>
                <td className="text-[var(--ink-500)]">{c.phone ?? ""}</td>
                <td className="td-num">{c.paymentTermsDays} days</td>
                <td>
                  <span className={`badge ${c.isActive ? "badge-posted" : "badge-neutral"}`}>
                    <span className="badge-dot" />
                    {c.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="text-right">
                  <form action={toggleContactAction} className="inline">
                    <input type="hidden" name="entityId" value={entityId} />
                    <input type="hidden" name="contactId" value={c.id} />
                    <input type="hidden" name="makeActive" value={String(!c.isActive)} />
                    <button className="btn btn-ghost btn-sm">
                      {c.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="fade-up">
      <PageHeader
        title="Customers &amp; suppliers"
        sub="Who you invoice and who bills you. Payment terms drive invoice due dates."
      />

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <form action={createCustomerAction} className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="entityId" value={entityId} />
        <div className="w-36">
          <label className="field-label">Type</label>
          <select name="type" className="select">
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="field-label">Name</label>
          <input name="name" required placeholder="Northwind Ltd" className="input" />
        </div>
        <div className="min-w-44 flex-1">
          <label className="field-label">Email</label>
          <input name="email" type="email" placeholder="billing@northwind.com" className="input" />
        </div>
        <div className="w-36">
          <label className="field-label">Phone</label>
          <input name="phone" placeholder="Optional" className="input" />
        </div>
        <div className="w-28">
          <label className="field-label">Terms (days)</label>
          <input
            name="paymentTermsDays"
            inputMode="numeric"
            defaultValue={30}
            className="input num text-right"
          />
        </div>
        <button className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          Add contact
        </button>
      </form>

      <div className="space-y-5">
        {table(customers, "Customers")}
        {table(suppliers, "Suppliers")}
      </div>
    </div>
  );
}
