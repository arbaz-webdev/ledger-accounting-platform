import { listPlans } from "@/services/plans";
import { fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { NewPlanForm } from "./new-plan-form";
import { updatePlanAction, setPlanActiveAction } from "../actions";

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const plans = await listPlans();

  return (
    <div className="fade-up">
      <PageHeader
        title="Plans"
        sub="What a subscription costs and what it allows. A blank limit means unlimited."
      />

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <details className="card mb-4 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-800)]">
          Add a plan
        </summary>
        <div className="mt-4">
          <NewPlanForm />
        </div>
      </details>

      <div className="space-y-3">
        {plans.map((p) => (
          <form
            key={p.id}
            action={updatePlanAction}
            className={`card p-4 ${p.isActive ? "" : "opacity-60"}`}
          >
            <input type="hidden" name="planId" value={p.id} />
            <input type="hidden" name="code" value={p.code} />

            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="acct text-[0.75rem] text-[var(--ink-400)]">{p.code}</span>
                <span className="num text-sm font-semibold text-[var(--brand-700)]">
                  {fmtMoney(p.monthlyPrice)}/mo
                </span>
              </div>
              <span className={`badge ${p.isActive ? "badge-posted" : "badge-neutral"}`}>
                <span className="badge-dot" />
                {p.isActive ? "available" : "retired"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="lg:col-span-2">
                <label className="field-label">Name</label>
                <input name="name" defaultValue={p.name} required className="input" />
              </div>
              <div>
                <label className="field-label">Price / month</label>
                <input
                  name="monthlyPrice"
                  inputMode="decimal"
                  defaultValue={p.monthlyPrice}
                  className="input num text-right"
                />
              </div>
              <div>
                <label className="field-label">Currency</label>
                <input name="currency" defaultValue={p.currency} maxLength={3} className="input acct uppercase" />
              </div>
              <div>
                <label className="field-label">Max clients</label>
                <input
                  name="maxEntities"
                  inputMode="numeric"
                  defaultValue={p.maxEntities ?? ""}
                  placeholder="unlimited"
                  className="input num text-right"
                />
              </div>
              <div>
                <label className="field-label">Max users</label>
                <input
                  name="maxUsers"
                  inputMode="numeric"
                  defaultValue={p.maxUsers ?? ""}
                  placeholder="unlimited"
                  className="input num text-right"
                />
              </div>
              <div className="lg:col-span-5">
                <label className="field-label">Description</label>
                <input name="description" defaultValue={p.description ?? ""} className="input" />
              </div>
              <div>
                <label className="field-label">Sort order</label>
                <input
                  name="sortOrder"
                  inputMode="numeric"
                  defaultValue={p.sortOrder}
                  className="input num text-right"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-[var(--ink-100)] pt-3">
              <button className="btn btn-secondary btn-sm">Save</button>
              <button
                formAction={setPlanActiveAction}
                name="makeActive"
                value={String(!p.isActive)}
                className="btn btn-ghost btn-sm"
              >
                {p.isActive ? "Retire" : "Make available"}
              </button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
