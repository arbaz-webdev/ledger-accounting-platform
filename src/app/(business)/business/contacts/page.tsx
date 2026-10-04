import { portalContext } from "@/lib/business-guard";
import { hasModule } from "@/services/permissions";
import { listContacts } from "@/services/contacts";
import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { createBusinessContactAction } from "./actions";

export default async function BusinessContactsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await portalContext();
  const [sales, purchases, canAddCustomer, canAddSupplier] = await Promise.all([
    hasModule(ctx.user, ctx.entityId, "sales"),
    hasModule(ctx.user, ctx.entityId, "purchases"),
    hasModule(ctx.user, ctx.entityId, "sales", "edit"),
    hasModule(ctx.user, ctx.entityId, "purchases", "edit"),
  ]);
  if (!sales && !purchases) redirect("/business?denied=sales");
  const rows = (await listContacts(ctx.entityId)).filter((contact) => contact.type === "customer" ? sales : purchases);
  const { error } = await searchParams;
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Customers & suppliers" sub="People and businesses you invoice or pay." />
    {error && <div className="banner banner-error mb-4" role="alert">{error}</div>}
    {(canAddCustomer || canAddSupplier) && <form action={createBusinessContactAction} className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block"><span className="field-label">Type</span><select name="type" className="select">{canAddCustomer && <option value="customer">Customer</option>}{canAddSupplier && <option value="supplier">Supplier</option>}</select></label>
      <label className="block"><span className="field-label">Name</span><input name="name" required className="input" /></label>
      <label className="block"><span className="field-label">Email</span><input name="email" type="email" className="input" /></label>
      <label className="block"><span className="field-label">Phone</span><input name="phone" className="input" /></label>
      <label className="block"><span className="field-label">Payment terms (days)</span><input name="paymentTermsDays" type="number" min="0" max="365" defaultValue="30" className="input" /></label>
      <button className="btn btn-brand sm:col-span-2 lg:col-span-5">Add contact</button>
    </form>}
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Phone</th><th className="text-right">Terms</th></tr></thead><tbody>
      {rows.map((contact) => <tr key={contact.id}><td className="font-medium">{contact.name}</td><td>{contact.type === "supplier" ? "Supplier" : "Customer"}</td><td>{contact.email}</td><td>{contact.phone}</td><td className="td-num">{contact.paymentTermsDays} days</td></tr>)}
    </tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-[var(--ink-500)]">No contacts yet.</p>}</div>
  </main>;
}
