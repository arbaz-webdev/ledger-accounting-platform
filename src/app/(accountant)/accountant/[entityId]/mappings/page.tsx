import { listAccounts } from "@/services/coa";
import { getMappings, MAPPING_DEFS } from "@/services/mappings";
import { PageHeader } from "@/components/ui";
import { setMappingAction, seedMappingsAction } from "./actions";

const MODULE_LABELS: Record<string, string> = {
  invoice: "Invoicing / Accounts Receivable",
  bill: "Bills / Accounts Payable",
  banking: "Banking",
  payroll: "Payroll",
  inventory: "Inventory",
  close: "Period & year-end close",
  fx: "Foreign exchange",
};

export default async function MappingsPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const [accounts, mappings] = await Promise.all([listAccounts(entityId), getMappings(entityId)]);
  const activeAccounts = accounts.filter((a) => a.isActive);
  const missing = MAPPING_DEFS.filter((d) => !mappings.has(d.key)).length;

  const modules = ["invoice", "bill", "banking", "payroll", "inventory", "close", "fx"] as const;

  return (
    <div className="fade-up">
      <PageHeader
        title="Account mapping"
        sub="Which ledger accounts each module posts to. Changes apply to future transactions only — posted entries keep the accounts they were posted with."
      >
        {missing > 0 && (
          <form action={seedMappingsAction}>
            <input type="hidden" name="entityId" value={entityId} />
            <button className="btn btn-primary">Fill {missing} from defaults</button>
          </form>
        )}
      </PageHeader>

      {missing > 0 && (
        <div className="banner banner-warn mb-4">
          <span>
            {missing} mapping{missing === 1 ? " is" : "s are"} unset. Modules fall back to the
            standard chart-of-accounts numbers until you configure them.
          </span>
        </div>
      )}

      <div className="space-y-5">
        {modules.map((mod) => {
          const defs = MAPPING_DEFS.filter((d) => d.module === mod);
          return (
            <div key={mod} className="card overflow-hidden">
              <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
                <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                  {MODULE_LABELS[mod]}
                </h2>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-[30%]">Purpose</th>
                    <th>What it does</th>
                    <th className="w-[34%]">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {defs.map((def) => {
                    const current = mappings.get(def.key);
                    return (
                      <tr key={def.key}>
                        <td className="font-medium text-[var(--ink-800)]">{def.label}</td>
                        <td className="text-[0.8125rem] text-[var(--ink-500)]">{def.hint}</td>
                        <td>
                          <form action={setMappingAction} className="flex items-center gap-2">
                            <input type="hidden" name="entityId" value={entityId} />
                            <input type="hidden" name="key" value={def.key} />
                            <select
                              name="accountId"
                              defaultValue={current ?? ""}
                              className="select input-cell"
                            >
                              <option value="" disabled>
                                Not set (default {def.defaultAccountNumber})
                              </option>
                              {activeAccounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.accountNumber} — {a.name}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn-secondary btn-sm">Save</button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
