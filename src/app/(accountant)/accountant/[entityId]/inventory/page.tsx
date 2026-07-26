import { listItems, inventoryGlTieOut } from "@/services/inventory";
import { fmtMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconRows, IconPlus } from "@/components/icons";

const METHOD_LABELS: Record<string, string> = {
  fifo: "FIFO",
  avco: "AVCO",
  specific: "Specific ID",
};

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const [items, tieOut] = await Promise.all([listItems(entityId), inventoryGlTieOut(entityId)]);
  const totalValue = items.reduce((s, it) => s + Number(it.valueOnHand), 0);

  return (
    <div className="fade-up">
      <PageHeader
        title="Inventory"
        sub={`${items.length} items · ${fmtMoney(totalValue)} on hand at cost`}
      >
        <a href={`/accountant/${entityId}/inventory/new`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New item
        </a>
      </PageHeader>

      {tieOut.inBalance ? (
        <div className="banner banner-ok mb-4">
          <span>
            Stock subledger agrees with the general ledger — {tieOut.account} balance{" "}
            {fmtMoney(tieOut.glBalance)}.
          </span>
        </div>
      ) : (
        <div className="banner banner-warn mb-4">
          <span>
            Subledger ({fmtMoney(tieOut.subledger)}) differs from {tieOut.account} (
            {fmtMoney(tieOut.glBalance)}) by {fmtMoney(tieOut.difference)}. Manual journal entries
            straight to the inventory account are the usual cause.
          </span>
        </div>
      )}

      <div className="card overflow-x-auto">
        {items.length === 0 ? (
          <EmptyState
            icon={<IconRows className="h-5 w-5" />}
            title="No inventory items yet"
            hint="Create an item, then receive stock via a supplier bill or a manual receipt."
            action={
              <a href={`/accountant/${entityId}/inventory/new`} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                New item
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Costing</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Avg cost</th>
                <th className="text-right">Value</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const qty = Number(it.qtyOnHand);
                const avg = qty > 0 ? Number(it.valueOnHand) / qty : 0;
                return (
                  <tr key={it.id} className={`tbl-row-link ${it.isActive ? "" : "opacity-55"}`}>
                    <td className="acct">
                      <a
                        href={`/accountant/${entityId}/inventory/${it.id}`}
                        className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                      >
                        {it.sku}
                      </a>
                    </td>
                    <td className="font-medium text-[var(--ink-800)]">{it.name}</td>
                    <td>
                      <span className="badge badge-neutral">{METHOD_LABELS[it.costingMethod]}</span>
                    </td>
                    <td className="td-num">
                      {qty} {it.unit}
                    </td>
                    <td className="td-num">{fmtMoney(avg)}</td>
                    <td className="td-num font-medium">{fmtMoney(it.valueOnHand)}</td>
                    <td className="text-right">
                      <span className={`badge ${it.isActive ? "badge-posted" : "badge-neutral"}`}>
                        <span className="badge-dot" />
                        {it.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
