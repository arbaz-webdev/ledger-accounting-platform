/**
 * Minimal RFC-4180 CSV parser — handles quoted fields, escaped quotes ("" inside
 * quotes), embedded commas/newlines, and CRLF. Also sniffs the delimiter so
 * semicolon-separated exports (common in European banks) work.
 */

export type ParsedCsv = { headers: string[]; rows: Record<string, string>[] };

function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    // count only delimiters outside quotes
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Split raw CSV text into a matrix of cells. */
export function parseCsvMatrix(text: string, delimiter?: string): string[][] {
  // strip UTF-8 BOM
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const d = delimiter ?? sniffDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // handled by the \n branch
    } else {
      field += ch;
    }
  }
  // trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // drop entirely blank rows
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Parse CSV with a header row into objects keyed by column name. */
export function parseCsv(text: string): ParsedCsv {
  const matrix = parseCsvMatrix(text);
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = matrix[0].map((h, i) => {
    const clean = h.trim();
    return clean === "" ? `Column ${i + 1}` : clean;
  });

  const rows = matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Column detection & value coercion
// ---------------------------------------------------------------------------

const DATE_HINTS = ["date", "posted", "transaction date", "value date", "booking"];
const DESC_HINTS = ["description", "narrative", "details", "particulars", "reference", "memo", "payee"];
const AMOUNT_HINTS = ["amount", "value", "transaction amount"];
const DEBIT_HINTS = ["debit", "withdrawal", "money out", "paid out", "out"];
const CREDIT_HINTS = ["credit", "deposit", "money in", "paid in", "in"];
const BALANCE_HINTS = ["balance", "running balance", "closing balance"];

function pick(headers: string[], hints: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  // exact match wins, then "starts with", then "contains"
  for (const hint of hints) {
    const exact = lower.indexOf(hint);
    if (exact !== -1) return headers[exact];
  }
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.startsWith(hint));
    if (idx !== -1) return headers[idx];
  }
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export type ColumnMapping = {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string | null;
  debitColumn: string | null;
  creditColumn: string | null;
  balanceColumn: string | null;
  dateFormat: "auto" | "dmy" | "mdy" | "ymd";
};

/** Best-guess column mapping from the header row. */
export function detectColumns(headers: string[]): ColumnMapping {
  const debit = pick(headers, DEBIT_HINTS);
  const credit = pick(headers, CREDIT_HINTS);
  const amount = pick(headers, AMOUNT_HINTS);

  return {
    dateColumn: pick(headers, DATE_HINTS) ?? headers[0] ?? "",
    descriptionColumn: pick(headers, DESC_HINTS) ?? headers[1] ?? "",
    // prefer explicit debit/credit pair when both exist, else a signed amount column
    amountColumn: debit && credit ? null : amount,
    debitColumn: debit && credit ? debit : null,
    creditColumn: debit && credit ? credit : null,
    balanceColumn: pick(headers, BALANCE_HINTS),
    dateFormat: "auto",
  };
}

/** Strip currency symbols, thousands separators and parenthesised negatives. */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s === "" || s === "-") return null;

  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "");
  s = s.replace(/[^\d.,]/g, ""); // drop currency symbols and spaces
  if (s === "") return null;

  // Decide which separator is the decimal point
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // European: 1.234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Anglo: 1,234.56
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse a date cell to ISO yyyy-mm-dd.
 * `format` disambiguates dd/mm vs mm/dd; "auto" infers per-value where possible.
 */
export function parseDate(raw: string, format: ColumnMapping["dateFormat"] = "auto"): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // ISO first
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return validIso(Number(y), Number(m), Number(d));
  }

  const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    let year = Number(parts[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;

    let day: number;
    let month: number;
    if (format === "mdy") {
      month = a;
      day = b;
    } else if (format === "dmy" || format === "ymd") {
      day = a;
      month = b;
    } else {
      // auto: a value > 12 in the first slot can only be a day
      if (a > 12) {
        day = a;
        month = b;
      } else if (b > 12) {
        month = a;
        day = b;
      } else {
        // genuinely ambiguous — assume day-first (most non-US bank exports)
        day = a;
        month = b;
      }
    }
    return validIso(year, month, day);
  }

  // Textual dates like "12 Jan 2026"
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function validIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}
