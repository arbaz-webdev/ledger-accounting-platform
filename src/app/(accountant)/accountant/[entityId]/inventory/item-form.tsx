"use client";

import { useState, useTransition } from "react";
import { createItemAction, updateItemAction } from "./actions";
import type { CostingMethod } from "@/services/inventory";

export type ItemDraft = {
  sku: string;
  name: string;
  description: string;
  costingMethod: CostingMethod;
  unit: string;
  salesPrice: string;
};

function ItemFields({
  draft,
  set,
  methodLocked,
}: {
  draft: ItemDraft;
  set: (patch: Partial<ItemDraft>) => void;
  methodLocked?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className="field-label">SKU</label>
        <input
          value={draft.sku}
          onChange={(e) => set({ sku: e.target.value })}
          placeholder="WID-001"
          className="input acct"
        />
      </div>
      <div className="lg:col-span-2">
        <label className="field-label">Name</label>
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Standard widget"
          className="input"
        />
      </div>
      <div>
        <label className="field-label">Costing method{methodLocked ? " (fixed)" : ""}</label>
        <select
          value={draft.costingMethod}
          onChange={(e) => set({ costingMethod: e.target.value as CostingMethod })}
          disabled={methodLocked}
          className="select"
          title={
            methodLocked
              ? "Costing method cannot change once set — create a new item instead"
              : undefined
          }
        >
          <option value="fifo">FIFO — first in, first out</option>
          <option value="avco">AVCO — weighted average</option>
          <option value="specific">Specific identification (lots)</option>
        </select>
      </div>
      <div>
        <label className="field-label">Unit</label>
        <input
          value={draft.unit}
          onChange={(e) => set({ unit: e.target.value })}
          placeholder="unit"
          className="input"
        />
      </div>
      <div>
        <label className="field-label">Default sales price</label>
        <input
          inputMode="decimal"
          value={draft.salesPrice}
          onChange={(e) => set({ salesPrice: e.target.value })}
          placeholder="0.00"
          className="input num"
        />
      </div>
      <div className="lg:col-span-3">
        <label className="field-label">Description</label>
        <input
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Optional"
          className="input"
        />
      </div>
    </div>
  );
}

export function NewItemForm({ entityId }: { entityId: string }) {
  const [draft, setDraft] = useState<ItemDraft>({
    sku: "",
    name: "",
    description: "",
    costingMethod: "fifo",
    unit: "unit",
    salesPrice: "0",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<ItemDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createItemAction(entityId, draft);
      if (result?.error) setError(result.error);
    });
  }

  const valid = draft.sku.trim() !== "" && draft.name.trim() !== "";

  return (
    <div className="card space-y-4 p-5">
      <ItemFields draft={draft} set={set} />
      <div className="flex items-center gap-3 border-t border-[var(--ink-100)] pt-4">
        <button disabled={pending || !valid} onClick={submit} className="btn btn-primary">
          {pending ? "Creating…" : "Create item"}
        </button>
        {error && <span className="text-[0.8125rem] text-[var(--negative)]">{error}</span>}
      </div>
    </div>
  );
}

export function EditItemForm({
  entityId,
  itemId,
  initial,
}: {
  entityId: string;
  itemId: string;
  initial: ItemDraft;
}) {
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<ItemDraft>) => {
    setSaved(false);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateItemAction(itemId, entityId, draft);
      if (result?.error) setError(result.error);
      else setSaved(true);
    });
  }

  const valid = draft.sku.trim() !== "" && draft.name.trim() !== "";

  return (
    <div className="space-y-4">
      <ItemFields draft={draft} set={set} methodLocked />
      <div className="flex items-center gap-3 border-t border-[var(--ink-100)] pt-4">
        <button disabled={pending || !valid} onClick={submit} className="btn btn-secondary">
          {pending ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-[0.8125rem] text-[var(--brand-700)]">Saved.</span>}
        {error && <span className="text-[0.8125rem] text-[var(--negative)]">{error}</span>}
      </div>
    </div>
  );
}
