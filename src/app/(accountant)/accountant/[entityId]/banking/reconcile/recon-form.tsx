"use client";

import { useMemo, useState } from "react";
import { fmtDate, fmtMoney } from "@/lib/format";
import { approveReconciliationAction } from "../actions";
import type { ReconWorkspace } from "@/services/bank-recon";
import { IconCheck, IconAlert } from "@/components/icons";

/**
 * statement balance = book balance − (signed total of items still outstanding)
 * so the difference updates live as the user ticks off what cleared the bank.
 */
export function ReconForm({
  entityId,
  workspace,
}: {
  entityId: string;
  workspace: ReconWorkspace;
}) {
  const [statementBalance, setStatementBalance] = useState("");
  const [cleared, setCleared] = useState<Set<string>>(
    () => new Set(workspace.openItems.map((i) => i.id))
  );

  const { outstanding, expected, difference, reconciles } = useMemo(() => {
    const book = Number(workspace.bookBalance);
    const out = workspace.openItems
      .filter((i) => !cleared.has(i.id))
      .reduce((s, i) => s + Number(i.amount), 0);
    const exp = book - out;
    const stated = statementBalance.trim() === "" ? NaN : Number(statementBalance);
    const diff = Number.isNaN(stated) ? NaN : stated - exp;
    return {
      outstanding: out,
      expected: exp,
      difference: diff,
      reconciles: !Number.isNaN(diff) && Math.abs(diff) < 0.005,
    };
  }, [workspace, cleared, statementBalance]);

  function toggle(id: string) {
    setCleared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={approveReconciliationAction}>
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="bankAccountId" value={workspace.bankAccountId} />
      <input type="hidden" name="statementDate" value={workspace.statementDate} />
      {[...cleared].map((id) => (
        <input key={id} type="hidden" name="clearedTxnIds" value={id} />
      ))}

      {/* Balance summary */}
      <div className="card mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label">Closing balance on statement</label>
            <input
              name="statementBalance"
              inputMode="decimal"
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
              placeholder="0.00"
              className="input num text-right"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--ink-500)]">Book balance</div>
            <div className="num mt-1.5 text-[0.9375rem] font-semibold text-[var(--ink-900)]">
              {fmtMoney(workspace.bookBalance)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--ink-500)]">Outstanding items</div>
            <div className="num mt-1.5 text-[0.9375rem] font-semibold text-[var(--ink-900)]">
              {fmtMoney(outstanding)}
            </div>
            <div className="text-[0.6875rem] text-[var(--ink-400)]">
              {workspace.openItems.length - cleared.size} not ticked
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--ink-500)]">Expected statement</div>
            <div className="num mt-1.5 text-[0.9375rem] font-semibold text-[var(--ink-900)]">
              {fmtMoney(expected)}
            </div>
          </div>
        </div>
      </div>

      {/* Live difference */}
      {statementBalance.trim() !== "" &&
        (reconciles ? (
          <div className="banner banner-ok mb-4">
            <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Reconciled — the statement agrees with the books after outstanding items.</span>
          </div>
        ) : (
          <div className="banner banner-warn mb-4">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Out by <span className="num font-semibold">{fmtMoney(difference)}</span>. Tick the
              items that appear on the statement, or check the closing balance you entered.
            </span>
          </div>
        ))}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-[var(--ink-100)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">
            Posted items not yet reconciled
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCleared(new Set(workspace.openItems.map((i) => i.id)))}
              className="btn btn-ghost btn-sm"
            >
              Tick all
            </button>
            <button
              type="button"
              onClick={() => setCleared(new Set())}
              className="btn btn-ghost btn-sm"
            >
              Clear
            </button>
          </div>
        </div>

        {workspace.openItems.length === 0 ? (
          <p className="px-5 py-8 text-center text-[0.8125rem] text-[var(--ink-400)]">
            Nothing outstanding — every posted bank transaction up to this date is already
            reconciled.
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-12">Cleared</th>
                <th>Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {workspace.openItems.map((i) => (
                <tr key={i.id} className={cleared.has(i.id) ? "" : "bg-[var(--warning-bg)]"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={cleared.has(i.id)}
                      onChange={() => toggle(i.id)}
                      aria-label={`Mark ${i.description} cleared`}
                    />
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(i.date)}</td>
                  <td className="max-w-[24rem] truncate">{i.description}</td>
                  <td className="td-num">{fmtMoney(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-4 py-3">
          <button disabled={!reconciles} className="btn btn-brand">
            Approve &amp; lock reconciliation
          </button>
          <span className="kbd-hint">
            Once approved the reconciliation is locked and cannot be altered.
          </span>
        </div>
      </div>
    </form>
  );
}
