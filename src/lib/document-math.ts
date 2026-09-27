import Decimal from "decimal.js";

export function calculateDocumentLine(line: { quantity: string | number; unitPrice: string | number; taxRate?: string | number }) {
  const qty = new Decimal(line.quantity || 0), price = new Decimal(line.unitPrice || 0), rate = new Decimal(line.taxRate || 0);
  if (![qty, price, rate].every(n => n.isFinite() && !n.isNegative())) throw new Error("Line values must be finite and nonnegative");
  if (qty.decimalPlaces() > 4 || price.decimalPlaces() > 4 || rate.decimalPlaces() > 4) throw new Error("Line values support at most four decimal places");
  const net = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const tax = net.times(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { qty, price, rate, net, tax };
}

/** Incomplete input is normal while typing; server submission uses strict validation. */
export function previewDocumentLine(line: Parameters<typeof calculateDocumentLine>[0]) {
  try { return calculateDocumentLine(line); }
  catch { return calculateDocumentLine({ quantity: "0", unitPrice: "0" }); }
}
