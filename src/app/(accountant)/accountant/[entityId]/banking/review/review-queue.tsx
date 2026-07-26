"use client";

import { useMemo, useState } from "react";
import { fmtDate, fmtMoney } from "@/lib/format";
import { categoriseAction, ignoreAction, postAction, createRuleAction } from "../actions";
import { IconAlert } from "@/components/icons";

type Txn = {
  id: string;
  date: string;
  description: string;
  amount: string;
  status: string;
  possibleDuplicate: boolean;
  categoryAccountId: string | null;
  categoryLabel: string | null;
  bankLabel: string;
};
type Account = { id: string; label: string };

export function ReviewQueue({
  entityId,
  transactions,
  accounts,
}: {
  entityId: string;
  transactions: Txn[];
  accounts: Account[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAccount, setBulkAccount] = useState("");
  const [ruleFor, setRuleFor] = useState<Txn | null>(null);

  const allSelected = transactions.length > 0 && selected.size === transactions.length;
  const selectedTxns = useMemo(
    () => transactions.filter((t) => selected.has(t.id)),
    [transactions, selected]
  );
  const readyToPost = selectedTxns.filter((t) => t.categoryAccountId).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(transactions.map((t) => t.id)));
  }

  const hiddenIds = (
    <>
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="txnIds" value={id} />
      ))}
      <input type="hidden" name="entityId" value={entityId} />
    </>
  );

  return (
    <>
      {/* Bulk action bar */}
      <div className="card sticky top-0 z-10 mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="text-[0.8125rem] text-[var(--ink-600)]">
          <span className="num font-semibold text-[var(--ink-900)]">{selected.size}</span> selected
          {selected.size > 0 && (
            <span className="text-[var(--ink-400)]"> · {readyToPost} ready to post</span>
          )}
        </div>

        <form action={categoriseAction} className="flex items-end gap-2">
          {hiddenIds}
          <div className="w-64">
            <label className="field-label">Set category</label>
            <select
              name="accountId"
              value={bulkAccount}
              onChange={(e) => setBulkAccount(e.target.value)}
              className="select input-cell"
            >
              <option value="">Select account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={selected.size === 0 || !bulkAccount}
            className="btn btn-secondary btn-sm"
          >
            Apply to {selected.size || "…"}
          </button>
        </form>

        <form action={postAction}>
          {hiddenIds}
          <button disabled={selected.size === 0} className="btn btn-brand btn-sm">
            Post {selected.size || ""} to ledger
          </button>
        </form>

        <form action={ignoreAction}>
          {hiddenIds}
          <button disabled={selected.size === 0} className="btn btn-ghost btn-sm">
            Ignore
          </button>
        </form>
      </div>

      {/* Create-rule panel */}
      {ruleFor && (
        <form action={createRuleAction} className="card mb-4 p-4">
          <input type="hidden" name="entityId" value={entityId} />
          <input
            type="hidden"
            name="returnTo"
            value={`/accountant/${entityId}/banking/review`}
          />
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink-900)]">
            Create a rule from “{ruleFor.description}”
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32">
              <label className="field-label">When description</label>
              <select name="matchType" defaultValue="contains" className="select">
                <option value="contains">contains</option>
                <option value="starts_with">starts with</option>
                <option value="equals">equals</option>
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label className="field-label">Text</label>
              <input
                name="matchText"
                defaultValue={ruleFor.description.split(/\s{2,}|,/)[0].slice(0, 40)}
                className="input"
              />
            </div>
            <div className="w-36">
              <label className="field-label">Direction</label>
              <select
                name="direction"
                defaultValue={Number(ruleFor.amount) >= 0 ? "money_in" : "money_out"}
                className="select"
              >
                <option value="any">Any</option>
                <option value="money_in">Money in</option>
                <option value="money_out">Money out</option>
              </select>
            </div>
            <div className="w-64">
              <label className="field-label">Categorise as</label>
              <select
                name="accountId"
                defaultValue={ruleFor.categoryAccountId ?? ""}
                className="select"
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary">Save rule</button>
            <button type="button" onClick={() => setRuleFor(null)} className="btn btn-ghost">
              Cancel
            </button>
          </div>
          <p className="kbd-hint mt-2">
            Rules apply to future imports. Existing rows keep the category you set here.
          </p>
        </form>
      )}

      {/* Transaction table */}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th className="text-right">Amount</th>
              <th>Category</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const isIn = Number(t.amount) >= 0;
              return (
                <tr key={t.id} className={selected.has(t.id) ? "bg-[var(--brand-50)]" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                      aria-label={`Select ${t.description}`}
                    />
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
                  <td className="max-w-[24rem]">
                    <span className="block truncate font-medium text-[var(--ink-800)]">
                      {t.description}
                    </span>
                    <span className="text-[0.6875rem] text-[var(--ink-400)]">{t.bankLabel}</span>
                    {t.possibleDuplicate && (
                      <span className="badge badge-pending ml-2">
                        <IconAlert className="h-3 w-3" />
                        Possible duplicate
                      </span>
                    )}
                  </td>
                  <td
                    className={`td-num font-medium ${isIn ? "text-[var(--brand-700)]" : "text-[var(--ink-800)]"}`}
                  >
                    {fmtMoney(t.amount)}
                  </td>
                  <td>
                    {t.categoryLabel ? (
                      <span className="badge badge-posted">{t.categoryLabel}</span>
                    ) : (
                      <span className="badge badge-neutral">Uncategorised</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => setRuleFor(t)}
                      className="btn btn-ghost btn-sm"
                    >
                      Rule…
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
