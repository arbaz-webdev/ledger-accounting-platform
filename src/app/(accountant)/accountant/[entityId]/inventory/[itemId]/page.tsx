import { notFound } from "next/navigation";
import { getItem } from "@/services/inventory";
import { listAccounts } from "@/services/coa";
import { resolveMapping } from "@/services/mappings";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui";
import { toggleItemActiveAction } from "../actions";
import { EditItemForm } from "../item-form";
import { MovementForm } from "./movement-form";

const METHOD_LABELS: Record<string, string> = {
  fifo: "FIFO",
  avco: "AVCO (weighted average)",
  specific: "Specific identification",
};

const KIND_LABELS: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  adjust_in: "Adjust up",
  adjust_out: "Adjust down",
  write_down: "Write-down",
};

const INBOUND = new Set(["receipt", "adjust_in"]);

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ entityId: string; itemId: string }>;
}) {
  const { entityId, itemId } = await params;
  const data = await getItem(itemId, entityId);
  if (!data) notFound();
  const { item, openLots, movements, qtyOnHand, valueOnHand } = data;

  const accounts = await listAccounts(entityId);
  const activeAccounts = accounts.filter((a) => a.isActive);
  const [grni, cogs, writedown] = await Promise.all([
    resolveMapping(entityId, "grni").catch(() => undefined),
    resolveMapping(entityId, "cogs").catch(() => undefined),
    resolveMapping(entityId, "inventory_writedown").catch(() => undefined),
  ]);

  const qty = Number(qtyOnHand);
  const avg = qty > 0 ? Number(valueOnHand) / qty : 0;

  return (
    <div className="fade-up">
      <PageHeader
        title={`${item.sku} — ${item.name}`}
        sub={`${METHOD_LABELS[item.costingMethod]} · ${item.isActive ? "active" : "inactive"}`}
      >
        <form action={toggleItemActiveAction}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="makeActive" value={String(!item.isActive)} />
          <button className="btn btn-secondary">
            {item.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      </PageHeader>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="On hand" value={`${qty} ${item.unit}`} />
        <StatCard label="Average cost" value={fmtMoney(avg)} />
        <StatCard label="Value at cost" value={fmtMoney(valueOnHand)} accent="brand" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Open cost layers</h2>
            </div>
            {openLots.length === 0 ? (
              <p className="px-5 py-6 text-center text-[0.8125rem] text-[var(--ink-400)]">
                No stock on hand.
              </p>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Lot ref</th>
                    <th className="text-right">Remaining</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {openLots.map((lot) => (
                    <tr key={lot.id}>
                      <td className="whitespace-nowrap">{fmtDate(lot.receivedDate)}</td>
                      <td className="acct">{lot.lotRef ?? ""}</td>
                      <td className="td-num">
                        {Number(lot.qtyRemaining)} / {Number(lot.qtyReceived)}
                      </td>
                      <td className="td-num">{fmtMoney(Number(lot.unitCost))}</td>
                      <td className="td-num font-medium">{fmtMoney(lot.costRemaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Movement history</h2>
            </div>
            {movements.length === 0 ? (
              <p className="px-5 py-6 text-center text-[0.8125rem] text-[var(--ink-400)]">
                No movements yet. Receive stock via a supplier bill or a manual receipt.
              </p>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => {
                    const inbound = INBOUND.has(m.kind);
                    return (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{fmtDate(m.date)}</td>
                        <td>
                          <span className={`badge ${inbound ? "badge-posted" : "badge-info"}`}>
                            {KIND_LABELS[m.kind] ?? m.kind}
                          </span>
                        </td>
                        <td className="acct">
                          <a
                            href={`/accountant/${entityId}/journal/${m.jeId}`}
                            className="hover:text-[var(--brand-700)] hover:underline"
                            title="View journal entry"
                          >
                            {m.reference ?? "journal entry"}
                          </a>
                        </td>
                        <td className="td-num">
                          {inbound ? "+" : "−"}
                          {Number(m.quantity)}
                        </td>
                        <td className="td-num">{fmtMoney(m.totalCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-[var(--ink-900)]">Item details</h2>
            <EditItemForm
              entityId={entityId}
              itemId={item.id}
              initial={{
                sku: item.sku,
                name: item.name,
                description: item.description ?? "",
                costingMethod: item.costingMethod,
                unit: item.unit,
                salesPrice: item.salesPrice,
              }}
            />
          </div>
        </div>

        <div className="h-fit space-y-4">
          <MovementForm
            entityId={entityId}
            itemId={item.id}
            isSpecific={item.costingMethod === "specific"}
            accounts={activeAccounts.map((a) => ({
              id: a.id,
              label: `${a.accountNumber} — ${a.name}`,
            }))}
            defaults={{ grni, cogs, writedown }}
            openLots={openLots.map((l) => ({
              id: l.id,
              lotRef: l.lotRef,
              receivedDate: l.receivedDate,
              qtyRemaining: l.qtyRemaining,
              costRemaining: l.costRemaining,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
