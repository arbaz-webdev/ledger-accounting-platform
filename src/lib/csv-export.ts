/**
 * CSV writing (the mirror of src/lib/csv.ts, which parses bank statements).
 * RFC 4180: quote anything containing a delimiter, quote or newline, and
 * double any embedded quotes.
 *
 * Values are written raw — money stays as plain decimal strings like
 * "1250.00" so spreadsheets read them as numbers, never as "(1,250.00)".
 */

export type CsvValue = string | number | null | undefined;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // A leading =, +, - or @ can be executed by spreadsheet apps; prefix with a
  // quote-safe apostrophe so exported data can never become a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Build the download Response for a CSV payload. */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** `trial-balance_2026-07-22.csv` */
export function exportFilename(report: string, suffix: string): string {
  return `${report}_${suffix}.csv`;
}
