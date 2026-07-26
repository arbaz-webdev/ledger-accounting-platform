// Integer-cents money helpers. Never use JS floats for money — pg returns
// numeric(18,2) as strings that can exceed Number's safe-integer range.

/** Parse a decimal string ("1500.00", "-12.5", "0") to integer cents (BigInt). */
export function parseCents(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  const s = typeof v === "number" ? v.toString() : v.trim();
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2));
  return neg ? -cents : cents;
}

/** Format integer cents to a fixed 2-dp string ("150000" cents -> "1500.00"). */
export function formatCents(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const s = abs.toString().padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Sum a list of cent values. */
export function sumCents(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}
