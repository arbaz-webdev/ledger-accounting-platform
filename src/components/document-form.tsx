"use client";

import { useMemo, useState, useTransition } from "react";
import { IconPlus } from "@/components/icons";
import { fmtMoney } from "@/lib/format";

export type Option = { id: string; label: string };
export type ItemOption = { id: string; label: string; salesPrice: string };
type LineDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
  accountId: string;
  taxRate: string;
  itemId: string;
};

const emptyLine = (): LineDraft => ({
  description: "",
  quantity: "1",
  unitPrice: "",
  accountId: "",
  taxRate: "0",
  itemId: "",
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Shared line-item document editor for invoices (AR) and bills (AP).
 * `variant` only changes labels and which account list is offered.
 * When `items` is provided, lines can reference an inventory item: invoices
 * auto-fill the sales price and post COGS; bill item lines are forced to the
 * inventory asset account (`inventoryAccountId`) and create stock lots.
 */
export function DocumentForm({
  entityId,
  variant,
  contacts,
  accounts,
  contactTerms,
  items,
  inventoryAccountId,
  baseCurrency,
  currencies,
  onSubmit,
}: {
  entityId: string;
  variant: "invoice" | "bill";
  contacts: Option[];
  accounts: Option[];
  contactTerms: Record<string, number>;
  items?: ItemOption[];
  inventoryAccountId?: string;
  /** entity base currency; the document defaults to it */
  baseCurrency: string;
  /** currencies with a rate on file, base first */
  currencies: string[];
  onSubmit: (payload: {
    entityId: string;
    contactId: string;
    supplierReference?: string;
    issueDate: string;
    dueDate: string;
    notes?: string;
    currency: string;
    postNow: boolean;
    lines: LineDraft[];
  }) => Promise<{ error?: string } | void>;
}) {
  const hasItems = (items?.length ?? 0) > 0;
  const hasFx = currencies.length > 1;
  const isInvoice = variant === "invoice";
  const today = new Date().toISOString().slice(0, 10);

  const [contactId, setContactId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [supplierReference, setSupplierReference] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totals = useMemo(() => {
    let net = 0;
    let tax = 0;
    for (const l of lines) {
      const lineNet = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      net += lineNet;
      tax += (lineNet * (Number(l.taxRate) || 0)) / 100;
    }
    return { net, tax, total: net + tax };
  }, [lines]);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickItem(i: number, itemId: string) {
    if (!itemId) {
      updateLine(i, { itemId: "" });
      return;
    }
    const item = items?.find((it) => it.id === itemId);
    if (!item) return;
    const patch: Partial<LineDraft> = { itemId, description: item.label };
    if (isInvoice && Number(item.salesPrice) > 0) patch.unitPrice = item.salesPrice;
    if (!isInvoice && inventoryAccountId) patch.accountId = inventoryAccountId;
    updateLine(i, patch);
  }

  function pickContact(id: string) {
    setContactId(id);
    const terms = contactTerms[id];
    if (terms !== undefined) setDueDate(addDays(issueDate, terms));
  }

  function changeIssueDate(value: string) {
    setIssueDate(value);
    const terms = contactTerms[contactId];
    if (terms !== undefined) setDueDate(addDays(value, terms));
  }

  const valid =
    contactId !== "" &&
    totals.total > 0 &&
    lines.some((l) => l.accountId && l.description.trim() && Number(l.quantity) > 0);

  function submit(postNow: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit({
        entityId,
        contactId,
        supplierReference: supplierReference || undefined,
        issueDate,
        dueDate,
        notes: notes || undefined,
        currency,
        postNow,
        lines,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-4 border-b border-[var(--ink-100)] bg-[var(--ink-50)] p-4">
        <div className="min-w-56 flex-1">
          <label className="field-label">{isInvoice ? "Customer" : "Supplier"}</label>
          <select
            value={contactId}
            onChange={(e) => pickContact(e.target.value)}
            className={`select ${contactId ? "" : "text-[var(--ink-400)]"}`}
          >
            <option value="">Select {isInvoice ? "customer" : "supplier"}…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className="field-label">Issue date</label>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => changeIssueDate(e.target.value)}
            className="input"
          />
        </div>
        <div className="w-40">
          <label className="field-label">Due date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="input"
          />
        </div>
        {hasFx && (
          <div className="w-28">
            <label className="field-label">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="select"
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        {!isInvoice && (
          <div className="w-44">
            <label className="field-label">Supplier reference</label>
            <input
              value={supplierReference}
              onChange={(e) => setSupplierReference(e.target.value)}
              placeholder="Their invoice no."
              className="input"
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              {hasItems && <th className="w-[14%]">Item</th>}
              <th className={hasItems ? "w-[20%]" : "w-[26%]"}>Description</th>
              <th className={hasItems ? "w-[18%]" : "w-[24%]"}>
                {isInvoice ? "Revenue account" : "Expense account"}
              </th>
              <th className="w-20 text-right">Qty</th>
              <th className="w-28 text-right">Unit price</th>
              <th className="w-20 text-right">Tax %</th>
              <th className="w-28 text-right">Line total</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const lineNet = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
              const lineTotal = lineNet + (lineNet * (Number(line.taxRate) || 0)) / 100;
              const forcedToInventory = !isInvoice && line.itemId !== "";
              return (
                <tr key={i}>
                  {hasItems && (
                    <td className="!py-1.5">
                      <select
                        value={line.itemId}
                        onChange={(e) => pickItem(i, e.target.value)}
                        className={`select input-cell ${line.itemId ? "" : "text-[var(--ink-400)]"}`}
                      >
                        <option value="">None</option>
                        {items!.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="!py-1.5">
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(i, { description: e.target.value })}
                      placeholder="Consulting services"
                      className="input input-cell"
                    />
                  </td>
                  <td className="!py-1.5">
                    {forcedToInventory ? (
                      <span
                        className="block px-1 text-[0.8125rem] text-[var(--ink-500)]"
                        title="Item lines post to the Inventory asset account via your account mappings"
                      >
                        → Inventory
                      </span>
                    ) : (
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(i, { accountId: e.target.value })}
                        className={`select input-cell ${line.accountId ? "" : "text-[var(--ink-400)]"}`}
                      >
                        <option value="">Select…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                      placeholder="0.00"
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="!py-1.5">
                    <input
                      inputMode="decimal"
                      value={line.taxRate}
                      onChange={(e) => updateLine(i, { taxRate: e.target.value })}
                      className="input input-cell num text-right"
                    />
                  </td>
                  <td className="td-num">{fmtMoney(lineTotal)}</td>
                  <td className="!py-1.5 text-center">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        className="rounded-md px-1.5 py-0.5 text-base leading-none text-[var(--ink-300)] transition-colors duration-150 hover:bg-[var(--negative-bg)] hover:text-[var(--negative)]"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 border-t border-[var(--ink-100)] p-4">
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
          className="btn btn-ghost btn-sm -ml-2"
        >
          <IconPlus className="h-3.5 w-3.5" />
          Add line
        </button>

        <div className="w-56 space-y-1 text-[0.8125rem]">
          <div className="flex justify-between text-[var(--ink-500)]">
            <span>Subtotal</span>
            <span className="num">{fmtMoney(totals.net)}</span>
          </div>
          <div className="flex justify-between text-[var(--ink-500)]">
            <span>Tax</span>
            <span className="num">{fmtMoney(totals.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-[var(--ink-200)] pt-1 font-semibold text-[var(--ink-900)]">
            <span>Total{currency !== baseCurrency ? ` (${currency})` : ""}</span>
            <span className="num">{fmtMoney(totals.total)}</span>
          </div>
          {currency !== baseCurrency && (
            <p className="pt-1 text-[0.6875rem] leading-snug text-[var(--ink-400)]">
              Posts to the ledger in {baseCurrency} at the {currency} rate ruling on the issue date.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-4 py-3">
        <button disabled={pending || !valid} onClick={() => submit(true)} className="btn btn-brand">
          {pending ? "Working…" : "Save & post"}
        </button>
        <button
          disabled={pending || !valid}
          onClick={() => submit(false)}
          className="btn btn-secondary"
        >
          Save as draft
        </button>
        <span className="kbd-hint ml-auto">
          Posting creates the journal entry using your account mappings.
        </span>
        {error && (
          <div className="banner banner-error w-full" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
