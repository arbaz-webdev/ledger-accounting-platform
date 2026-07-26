import { listRules } from "@/services/bank-rules";
import { listAccounts } from "@/services/coa";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconRows, IconPlus } from "@/components/icons";
import { createRuleAction, toggleRuleAction, deleteRuleAction } from "../actions";

const MATCH_LABEL: Record<string, string> = {
  contains: "contains",
  starts_with: "starts with",
  equals: "equals",
};
const DIRECTION_LABEL: Record<string, string> = {
  any: "Any",
  money_in: "Money in",
  money_out: "Money out",
};

export default async function RulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId } = await params;
  const { error } = await searchParams;

  const [rules, accounts] = await Promise.all([listRules(entityId), listAccounts(entityId)]);
  const categoryAccounts = accounts.filter((a) => a.isActive && a.subType !== "cash_and_bank");

  return (
    <div className="fade-up">
      <PageHeader
        title="Categorisation rules"
        sub="Applied in priority order when a statement is imported. Unmatched lines go to suspense."
      >
        <a href={`/accountant/${entityId}/banking`} className="btn btn-secondary">
          Back to banking
        </a>
      </PageHeader>

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <form action={createRuleAction} className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="entityId" value={entityId} />
        <div className="w-20">
          <label className="field-label">Priority</label>
          <input name="priority" inputMode="numeric" defaultValue={100} className="input num text-right" />
        </div>
        <div className="w-32">
          <label className="field-label">When description</label>
          <select name="matchType" className="select">
            <option value="contains">contains</option>
            <option value="starts_with">starts with</option>
            <option value="equals">equals</option>
          </select>
        </div>
        <div className="min-w-44 flex-1">
          <label className="field-label">Text</label>
          <input name="matchText" required placeholder="RENT" className="input" />
        </div>
        <div className="w-36">
          <label className="field-label">Direction</label>
          <select name="direction" className="select">
            <option value="any">Any</option>
            <option value="money_in">Money in</option>
            <option value="money_out">Money out</option>
          </select>
        </div>
        <div className="w-60">
          <label className="field-label">Categorise as</label>
          <select name="accountId" required className="select">
            <option value="">Select account…</option>
            {categoryAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          Add rule
        </button>
      </form>

      <div className="card overflow-x-auto">
        {rules.length === 0 ? (
          <EmptyState
            icon={<IconRows className="h-5 w-5" />}
            title="No rules yet"
            hint="Add a rule above, or create one straight from a transaction in the review queue."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-20 text-right">Priority</th>
                <th>Condition</th>
                <th>Direction</th>
                <th>Account</th>
                <th className="text-right">Times used</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={r.isActive ? "" : "opacity-55"}>
                  <td className="td-num">{r.priority}</td>
                  <td>
                    <span className="text-[var(--ink-500)]">
                      Description {MATCH_LABEL[r.matchType]}
                    </span>{" "}
                    <span className="font-medium text-[var(--ink-900)]">“{r.matchText}”</span>
                  </td>
                  <td>{DIRECTION_LABEL[r.direction]}</td>
                  <td>
                    <span className="acct mr-2">{r.accountNumber}</span>
                    {r.accountName}
                  </td>
                  <td className="td-num">{r.timesApplied}</td>
                  <td>
                    <span className={`badge ${r.isActive ? "badge-posted" : "badge-neutral"}`}>
                      <span className="badge-dot" />
                      {r.isActive ? "Active" : "Off"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <form action={toggleRuleAction} className="inline">
                      <input type="hidden" name="entityId" value={entityId} />
                      <input type="hidden" name="ruleId" value={r.id} />
                      <input type="hidden" name="makeActive" value={String(!r.isActive)} />
                      <button className="btn btn-ghost btn-sm">
                        {r.isActive ? "Disable" : "Enable"}
                      </button>
                    </form>
                    <form action={deleteRuleAction} className="inline">
                      <input type="hidden" name="entityId" value={entityId} />
                      <input type="hidden" name="ruleId" value={r.id} />
                      <button className="btn btn-ghost btn-sm text-[var(--negative)]">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
