"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnMapping } from "@/lib/csv";
import type { ImportPreview, ImportResult } from "@/services/bank-import";
import { repreviewAction, importCsvAction } from "../actions";
import { fmtMoney } from "@/lib/format";
import { IconCheck, IconAlert } from "@/components/icons";

type BankAccount = { id: string; number: string; name: string };

export function ImportWizard({
  entityId,
  bankAccounts,
}: {
  entityId: string;
  bankAccounts: BankAccount[];
}) {
  const router = useRouter();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFileChosen(file: File) {
    setError(null);
    setResult(null);
    if (file.size > 5_000_000) {
      setError("File is larger than 5 MB — split the statement and try again");
      return;
    }
    const text = await file.text();
    setCsvText(text);
    setFilename(file.name);
    startTransition(async () => {
      try {
        // detect on the server so parsing rules stay in one place
        const detected = await repreviewAction(text, {
          dateColumn: "",
          descriptionColumn: "",
          amountColumn: null,
          debitColumn: null,
          creditColumn: null,
          balanceColumn: null,
          dateFormat: "auto",
        });
        // first call returns headers; ask again with the auto-detected mapping
        const auto = autoDetect(detected.headers);
        const p = await repreviewAction(text, auto);
        setMapping(auto);
        setPreview(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that file");
      }
    });
  }

  function updateMapping(patch: Partial<ColumnMapping>) {
    if (!mapping || !csvText) return;
    const next = { ...mapping, ...patch };
    setMapping(next);
    startTransition(async () => {
      setPreview(await repreviewAction(csvText, next));
    });
  }

  function runImport() {
    if (!csvText || !mapping || !bankAccountId) return;
    setError(null);
    startTransition(async () => {
      const res = await importCsvAction({
        entityId,
        bankAccountId,
        filename,
        csvText,
        mapping,
      });
      if (res.error) setError(res.error);
      else if (res.result) setResult(res.result);
    });
  }

  const headers = preview?.headers ?? [];
  const colSelect = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    optional = false
  ) => (
    <div>
      <label className="field-label">{label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="select"
      >
        {optional && <option value="">— none —</option>}
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );

  // Success screen
  if (result) {
    return (
      <div className="card p-6">
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Imported {result.imported} transaction{result.imported === 1 ? "" : "s"} from{" "}
            {filename}.
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["Imported", result.imported],
            ["Auto-categorised", result.categorised],
            ["Exact duplicates skipped", result.duplicates],
            ["Flagged as possible duplicates", result.flagged],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-[var(--ink-500)]">{label}</dt>
              <dd className="num mt-0.5 text-lg font-semibold text-[var(--ink-900)]">{value}</dd>
            </div>
          ))}
        </dl>
        {result.rejected > 0 && (
          <p className="mt-4 text-[0.8125rem] text-[var(--warning)]">
            {result.rejected} row(s) were rejected during validation and not imported.
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => router.push(`/accountant/${entityId}/banking/review`)}
            className="btn btn-brand"
          >
            Review imported transactions
          </button>
          <button
            onClick={() => {
              setResult(null);
              setPreview(null);
              setCsvText(null);
            }}
            className="btn btn-secondary"
          >
            Import another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Step 1 — file + account */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 flex-1">
            <label className="field-label">Bank account</label>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="select"
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-64 flex-1">
            <label className="field-label">Statement CSV</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileChosen(f);
              }}
              className="input h-auto py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--ink-100)] file:px-3 file:py-1 file:text-[0.8125rem] file:font-medium file:text-[var(--ink-700)]"
            />
          </div>
        </div>
        {error && (
          <div className="banner banner-error mt-3" role="alert">
            {error}
          </div>
        )}
      </div>

      {/* Step 2 — column mapping */}
      {preview && mapping && (
        <>
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--ink-900)]">
              Column mapping
              <span className="ml-2 font-normal text-[var(--ink-500)]">
                detected from “{filename}” — adjust if your bank uses different headings
              </span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {colSelect("Date", mapping.dateColumn, (v) => updateMapping({ dateColumn: v ?? "" }))}
              {colSelect("Description", mapping.descriptionColumn, (v) =>
                updateMapping({ descriptionColumn: v ?? "" })
              )}
              <div>
                <label className="field-label">Date format</label>
                <select
                  value={mapping.dateFormat}
                  onChange={(e) =>
                    updateMapping({ dateFormat: e.target.value as ColumnMapping["dateFormat"] })
                  }
                  className="select"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="dmy">Day first (31/12/2026)</option>
                  <option value="mdy">Month first (12/31/2026)</option>
                  <option value="ymd">Year first (2026-12-31)</option>
                </select>
              </div>
              {colSelect(
                "Single amount column (signed)",
                mapping.amountColumn,
                (v) => updateMapping({ amountColumn: v, debitColumn: null, creditColumn: null }),
                true
              )}
              {colSelect(
                "Money out (debit)",
                mapping.debitColumn,
                (v) => updateMapping({ debitColumn: v, amountColumn: null }),
                true
              )}
              {colSelect(
                "Money in (credit)",
                mapping.creditColumn,
                (v) => updateMapping({ creditColumn: v, amountColumn: null }),
                true
              )}
              {colSelect(
                "Statement balance",
                mapping.balanceColumn,
                (v) => updateMapping({ balanceColumn: v }),
                true
              )}
            </div>
            <p className="kbd-hint mt-3">
              Use either one signed amount column, or a separate money-out / money-in pair.
            </p>
          </div>

          {/* Step 3 — preview */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ink-100)] px-5 py-3.5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Preview</h2>
              <div className="flex items-center gap-3 text-[0.8125rem]">
                <span className="text-[var(--brand-700)]">{preview.validCount} valid</span>
                {preview.errorCount > 0 && (
                  <span className="text-[var(--negative)]">{preview.errorCount} with problems</span>
                )}
              </div>
            </div>

            {preview.errorCount > 0 && (
              <div className="banner banner-warn m-4">
                <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Rows with problems are skipped on import. If most rows are failing, the column
                  mapping or date format is probably wrong.
                </span>
              </div>
            )}

            <div className="max-h-96 overflow-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-14">Row</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="acct">{r.rowNumber}</td>
                      <td className="whitespace-nowrap">{r.date ?? "—"}</td>
                      <td className="max-w-[22rem] truncate">{r.description || "—"}</td>
                      <td className="td-num">{r.amount !== null ? fmtMoney(r.amount) : "—"}</td>
                      <td>
                        {r.error ? (
                          <span className="badge badge-voided">{r.error}</span>
                        ) : (
                          <span className="badge badge-posted">
                            <span className="badge-dot" />
                            {r.amount! >= 0 ? "Money in" : "Money out"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 50 && (
              <p className="kbd-hint px-5 py-2">
                Showing the first 50 of {preview.rows.length} rows.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-100)] bg-[var(--ink-50)] px-4 py-3">
              <button
                onClick={runImport}
                disabled={pending || preview.validCount === 0 || !bankAccountId}
                className="btn btn-brand"
              >
                {pending ? "Importing…" : `Import ${preview.validCount} transaction(s)`}
              </button>
              <span className="kbd-hint">
                Rows are staged for review — nothing reaches the ledger until you post them.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Client-side mirror of the server's header heuristics (keeps the UI snappy). */
function autoDetect(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (hints: string[]) => {
    for (const hint of hints) {
      const i = lower.findIndex((h) => h === hint);
      if (i !== -1) return headers[i];
    }
    for (const hint of hints) {
      const i = lower.findIndex((h) => h.includes(hint));
      if (i !== -1) return headers[i];
    }
    return null;
  };
  const debit = find(["debit", "withdrawal", "money out", "paid out"]);
  const credit = find(["credit", "deposit", "money in", "paid in"]);
  const amount = find(["amount", "value"]);
  return {
    dateColumn: find(["date", "posted", "value date"]) ?? headers[0] ?? "",
    descriptionColumn:
      find(["description", "narrative", "details", "particulars", "memo", "payee"]) ??
      headers[1] ??
      "",
    amountColumn: debit && credit ? null : amount,
    debitColumn: debit && credit ? debit : null,
    creditColumn: debit && credit ? credit : null,
    balanceColumn: find(["balance"]),
    dateFormat: "auto",
  };
}
