import { guardPortal } from "@/lib/business-guard";
import { hasModule } from "@/services/permissions";
import { listItems } from "@/services/inventory";
import { PageHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { createBusinessItemAction } from "./actions";

export default async function BusinessCatalogPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const portal = await guardPortal("inventory");
  const canEdit = await hasModule(portal.user, portal.entityId, "inventory", "edit");
  const [items, { error }] = await Promise.all([listItems(portal.entityId), searchParams]);
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Products & services" sub="Sell services without stock movements; track product quantity and value." />
    {error && <div className="banner banner-error mb-4" role="alert">{error}</div>}
    {canEdit && <form action={createBusinessItemAction} className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label><span className="field-label">Kind</span><select name="kind" className="select"><option value="product">Product</option><option value="service">Service</option></select></label>
      <label><span className="field-label">SKU / code</span><input name="sku" required maxLength={80} className="input" /></label>
      <label><span className="field-label">Name</span><input name="name" required maxLength={200} className="input" /></label>
      <label><span className="field-label">Sales price</span><input name="salesPrice" required inputMode="decimal" defaultValue="0" className="input" /></label>
      <label><span className="field-label">Unit</span><input name="unit" defaultValue="unit" className="input" /></label>
      <label><span className="field-label">Reorder level (products)</span><input name="reorderLevel" inputMode="decimal" defaultValue="0" className="input" /></label>
      <label><span className="field-label">Product costing method</span><select name="costingMethod" className="select"><option value="fifo">FIFO</option><option value="avco">Weighted average</option><option value="specific">Specific lots</option></select></label>
      <label className="sm:col-span-2"><span className="field-label">Description</span><input name="description" className="input" /></label>
      <button className="btn btn-brand sm:col-span-2 lg:col-span-4">Add product or service</button>
    </form>}
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Unit</th><th className="text-right">Sales price</th><th className="text-right">On hand</th><th className="text-right">Stock value</th><th>Status</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td>{item.sku}</td><td className="font-medium">{item.name}</td><td>{item.isService ? "Service" : "Product"}</td><td>{item.unit}</td><td className="td-num">{fmtMoney(item.salesPrice)}</td><td className="td-num">{item.isService ? "—" : item.qtyOnHand}</td><td className="td-num">{item.isService ? "—" : fmtMoney(item.valueOnHand)}</td><td>{!item.isService && Number(item.reorderLevel) > 0 && Number(item.qtyOnHand) <= Number(item.reorderLevel) ? <span className="badge badge-voided">Reorder</span> : ""}</td></tr>)}
    </tbody></table>{items.length === 0 && <p className="p-4 text-sm text-[var(--ink-500)]">No products or services yet.</p>}</div>
  </main>;
}
