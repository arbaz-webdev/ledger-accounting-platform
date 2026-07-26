"use client";

import { useMemo, useState, useTransition } from "react";
import { fmtMoney } from "@/lib/format";
import { recordMovementAction } from "../actions";

type Kind = "receipt" | "issue" | "adjust_in" | "adjust_out" | "write_down";

export type AccountOption = { id: string; label: string };
export type OpenLot = {
  id: string;
  lotRef: string | null;
  receivedDate: string;
  qtyRemaining: string;
  costRemaining: string;
};

const KIND_META: Record<
  Kind,
  { label: string; inbound: boolean; counterLabel: string; hint: string }
> = {
  receipt: {
    label: "Receive stock",
    inbound: true,
    counterLabel: "Credit account",
    hint: "DR Inventory / CR the account below (default: Goods Received Not Invoiced).",
  },
  issue: {
    label: "Issue stock",
    inbound: false,
    counterLabel: "Debit account",
    hint: "DR the account below (default: COGS) / CR Inventory at computed cost.",
  },
  adjust_in: {
    label: "Adjust count up",
    inbound: true,
    counterLabel: "Credit account",
    hint: "Found stock: DR Inventory / CR write-down (recovery).",
  },
  adjust_out: {
    label: "Adjust count down",
    inbound: false,
    counterLabel: "Debit account",
    hint: "Missing stock: DR write-down / CR Inventory at computed cost.",
  },
  write_down: {
    label: "Write down",
    inbound: false,
    counterLabel: "Debit account",
    hint: "Damaged or obsolete stock: DR write-down / CR Inventory at computed cost.",
  },
};

export function MovementForm({
  entityId,
  itemId,
  isSpecific,
  accounts,
  defaults,
  openLots,
}: {
  entityId: string;
  itemId: string;
  isSpecific: boolean;
  accounts: AccountOption[];
  defaults: { grni?: string; cogs?: string; writedown?: string };
  openLots: OpenLot[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<Kind>("receipt");
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lotRef, setLotRef] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [pickQty, setPickQty] = useState<Record<string, string>>({});
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const meta = KIND_META[kind];
  const defaultCounter =
    kind === "receipt" ? defaults.grni : kind === "issue" ? defaults.cogs : defaults.writedown;
  const usePicker = isSpecific && !meta.inbound;

  const pickTotal = useMemo(
    () => Object.values(pickQty).reduce((s, v) => s + (Number(v) || 0), 0),
    [pickQty]
  );
  const effectiveQty = usePicker ? String(pickTotal || "") : quantity;

  function switchKind(next: Kind) {
    setKind(next);
    setCounterAccountId("");
    setError(null);
    setDone(null);
  }

  function submit() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await recordMovementAction(entityId, {
        itemId,
        kind,
        date,
        quantity: effectiveQty,
        unitCost: meta.inbound ? unitCost : undefined,
        lotRef: meta.inbound && lotRef ? lotRef : undefined,
        counterAccountId: counterAccountId || undefined,
        picks: usePicker
          ? Object.entries(pickQty)
              .filter(([, q]) => Number(q) > 0)
              .map(([lotId, q]) => ({ lotId, quantity: q }))
          : undefined,
        reference: reference || undefined,
      });
      if (result?.error) setError(result.error);
      else {
        setDone(`${meta.label} recorded.`);
        setQuantity("");
        setUnitCost("");
        setLotRef("");
        setPickQty({});
        setReference("");
      }
    });
  }

  const valid =
    Number(effectiveQty) > 0 && date !== "" && (!meta.inbound || Number(unitCost) > 0);

  return (
    <div className="card p-4">
      <h2 className="mb-1 text-sm font-semibold text-[var(--ink-900)]">Record movement</h2>
      <p className="mb-3 text-[0.75rem] text-[var(--ink-400)]">{meta.hint}</p>

      <div className="space-y-3">
        <div>
          <label className="field-label">Type</label>
          <select value={kind} onChange={(e) => switchKind(e.target.value as Kind)} className="select">
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </div>

        {usePicker ? (
          <div>
            <label className="field-label">Lots to issue from</label>
            {openLots.length === 0 ? (
              <p className="text-[0.8125rem] text-[var(--ink-400)]">No stock on hand.</p>
            ) : (
              <div className="space-y-1.5">
                {openLots.map((lot) => (
                  <div key={lot.id} className="flex items-center gap-2 text-[0.8125rem]">
                    <span className="acct min-w-0 flex-1 truncate">
                      {lot.lotRef ?? lot.receivedDate} · {Number(lot.qtyRemaining)} left ·{" "}
                      {fmtMoney(lot.costRemaining)}
                    </span>
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      value={pickQty[lot.id] ?? ""}
                      onChange={(e) =>
                        setPickQty((prev) => ({ ...prev, [lot.id]: e.target.value }))
                      }
                      className="input input-cell num w-20 text-right"
                    />
                  </div>
                ))}
                <div className="text-right text-[0.75rem] text-[var(--ink-500)]">
                  Total: <span className="num font-medium">{pickTotal || 0}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="field-label">Quantity</label>
            <input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="input num text-right"
            />
          </div>
        )}

        {meta.inbound && (
          <>
            <div>
              <label className="field-label">Unit cost</label>
              <input
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
                className="input num text-right"
              />
            </div>
            {isSpecific && (
              <div>
                <label className="field-label">Lot reference</label>
                <input
                  value={lotRef}
                  onChange={(e) => setLotRef(e.target.value)}
                  placeholder="e.g. BATCH-2026-07"
                  className="input"
                />
              </div>
            )}
          </>
        )}

        <div>
          <label className="field-label">{meta.counterLabel}</label>
          <select
            value={counterAccountId || defaultCounter || ""}
            onChange={(e) => setCounterAccountId(e.target.value)}
            className="select"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Optional"
            className="input"
          />
        </div>

        <button disabled={pending || !valid} onClick={submit} className="btn btn-brand w-full">
          {pending ? "Recording…" : meta.label}
        </button>
        {done && <p className="text-[0.8125rem] text-[var(--brand-700)]">{done}</p>}
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
