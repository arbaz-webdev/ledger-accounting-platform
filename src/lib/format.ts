/**
 * Money display follows accounting convention: negatives in parentheses,
 * e.g. -1250.5 -> "(1,250.50)". Always pair with tabular numerals (.num).
 */
import Decimal from "decimal.js";

function formatDecimal(value: string | number, places: number): string {
  const n = new Decimal(value || 0);
  const [whole, fractional] = n.abs().toFixed(places, Decimal.ROUND_HALF_UP).split(".");
  const formatted = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fractional}`;
  return n.isNegative() ? `(${formatted})` : formatted;
}

export function fmtMoney(value: string | number): string {
  return formatDecimal(value, 2);
}

export function fmtUnitPrice(value: string | number): string {
  return formatDecimal(value, 4);
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
