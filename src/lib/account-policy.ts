export type AccountPolicy = { type: string; subType: string | null; isActive: boolean };
const CONTROL_SUBTYPES = new Set(["receivable", "payable", "inventory", "payroll", "tax", "suspense"]);

export function allowsBankCategory(a: AccountPolicy) {
  return a.isActive && a.subType !== "cash_and_bank" && !CONTROL_SUBTYPES.has(a.subType ?? "") && a.type !== "equity";
}

export function allowsBillCoding(a: AccountPolicy) {
  return a.isActive && ["expense", "cogs", "other_expense", "asset"].includes(a.type) &&
    ![...CONTROL_SUBTYPES, "cash_and_bank", "contra_asset", "contra_cogs"].includes(a.subType ?? "");
}
