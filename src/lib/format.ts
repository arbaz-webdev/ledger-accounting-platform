/**
 * Money display follows accounting convention: negatives in parentheses,
 * e.g. -1250.5 -> "(1,250.50)". Always pair with tabular numerals (.num).
 */
export function fmtMoney(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

export function isNegative(value: string | number): boolean {
  return (typeof value === "string" ? Number(value) : value) < 0;
}

export function fmtDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
