"use client";

import { useMemo, useState, useTransition } from "react";
import { submitJournalEntry } from "../actions";
import { IconPlus, IconCheck, IconAlert } from "@/components/icons";

type AccountOption = { id: string; label: string };
type LineDraft = { accountId: string; description: string; debit: string; credit: string };

const emptyLine = (): LineDraft => ({ accountId: "", description: "", debit: "", credit: "" });

export function JournalEntryForm({
  entityId,
  accounts,
}: {
  entityId: string;
  accounts: AccountOption[];
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      debit += Number(l.debit) || 0;
      credit += Number(l.credit) || 0;
    }
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [lines]);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit(saveAs: "posted" | "draft") {
    setError(null);
    startTransition(async () => {
      const result = await submitJournalEntry({
        entityId,
        date,
        description,
        reference: reference || undefined,
        saveAs,
        lines,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="card overflow-hidden">
      {/* Header fields */}
      <div className="flex flex-wrap gap-4 border-b border-[var(--ink-100)] bg-[var(--ink-50)] p-4">
        <div className="w-40">
          <label className="field-label">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </div>
        <div className="min-w-64 flex-1">
          <label className="field-label">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Accrue July office rent"
            className="input"
          />
        </div>
        <div className="w-40">
          <label className="field-label">Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Optional"
            className="input"
          />
        </div>
      </div>

      {/* Lines */}
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-[34%]">Account</th>
            <th>Line description</th>
            <th className="w-32 text-right">Debit</th>
            <th className="w-32 text-right">Credit</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="!py-1.5">
                <select
                  value={line.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.target.value })}
                  className={`select input-cell ${line.accountId ? "" : "text-[var(--ink-400)]"}`}
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="!py-1.5">
                <input
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  placeholder="Optional"
                  className="input input-cell"
                />
              </td>
              <td className="!py-1.5">
                <input
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })}
                  placeholder="0.00"
                  className="input input-cell num text-right"
                />
              </td>
              <td className="!py-1.5">
                <input
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })}
                  placeholder="0.00"
                  className="input input-cell num text-right"
                />
              </td>
              <td className="!py-1.5 text-center">
                {lines.length > 2 && (
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
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
                className="btn btn-ghost btn-sm -ml-2"
              >
                <IconPlus className="h-3.5 w-3.5" />
                Add line
              </button>
            </td>
            <td className="td-num">{totals.debit.toFixed(2)}</td>
            <td className="td-num">{totals.credit.toFixed(2)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-4 py-3">
        <button
          disabled={pending || !totals.balanced || !description}
          onClick={() => submit("posted")}
          className="btn btn-brand"
        >
          {pending ? "Posting…" : "Post entry"}
        </button>
        <button
          disabled={pending || !totals.balanced || !description}
          onClick={() => submit("draft")}
          className="btn btn-secondary"
        >
          Save as draft
        </button>

        <div className="ml-auto flex items-center gap-2 text-[0.8125rem]">
          {totals.balanced ? (
            <span className="flex items-center gap-1.5 font-medium text-[var(--brand-700)]">
              <IconCheck className="h-4 w-4" />
              Balanced
            </span>
          ) : totals.debit > 0 || totals.credit > 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-[var(--warning)]">
              <IconAlert className="h-4 w-4" />
              Out of balance by {Math.abs(totals.debit - totals.credit).toFixed(2)}
            </span>
          ) : (
            <span className="kbd-hint">Enter at least one debit and one credit</span>
          )}
        </div>
        {error && (
          <div className="banner banner-error w-full" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
