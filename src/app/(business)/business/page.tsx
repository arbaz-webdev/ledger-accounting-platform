import { portalContext } from "@/lib/business-guard";
import { getProfitAndLoss, defaultFiscalRange } from "@/services/statements";
import { getArAgeing, getApAgeing } from "@/services/ageing";
import { MODULE_LABEL, type ModuleKey } from "@/services/permissions";
import { fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { IconShield } from "@/components/icons";

export default async function BusinessDashboard({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { entityName, entityId, baseCurrency, allowed } = await portalContext();
  const { denied } = await searchParams;

  const canReports = allowed.has("reports");
  const today = todayIso();

  let pl = null;
  let arTotal = "0.00";
  let apTotal = "0.00";
  if (canReports) {
    const range = defaultFiscalRange(today, 1);
    const [plResult, ar, ap] = await Promise.all([
      getProfitAndLoss(entityId, range.from, range.to),
      allowed.has("sales") ? getArAgeing(entityId, today) : null,
      allowed.has("purchases") ? getApAgeing(entityId, today) : null,
    ]);
    pl = plResult;
    arTotal = ar?.total ?? "0.00";
    apTotal = ap?.total ?? "0.00";
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="fade-up">
        <PageHeader
          title={entityName}
          sub="Your accountant keeps the books — this is a live, read-only window into them."
        />

        {denied && (
          <div className="banner banner-warn mb-4">
            <span>
              You don&apos;t have access to{" "}
              {MODULE_LABEL[denied as ModuleKey] ?? denied}. Ask your accountant if you need it.
            </span>
          </div>
        )}

        {!canReports ? (
          <div className="card">
            <EmptyState
              icon={<IconShield className="h-5 w-5" />}
              title="Nothing shared with you yet"
              hint="Your accountant hasn't enabled any areas for your account. They can grant access under Users & permissions."
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Revenue (year to date)"
                value={fmtMoney(pl!.revenue.net)}
                hint={baseCurrency}
              />
              <StatCard
                label="Net profit (year to date)"
                value={fmtMoney(pl!.netProfit)}
                accent={Number(pl!.netProfit) < 0 ? "negative" : "brand"}
                hint={baseCurrency}
              />
              {allowed.has("sales") && (
                <StatCard label="Owed to you" value={fmtMoney(arTotal)} hint="Open invoices" />
              )}
              {allowed.has("purchases") && (
                <StatCard label="You owe" value={fmtMoney(apTotal)} hint="Open bills" />
              )}
            </div>

            <div className="card mt-5 p-5">
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">Where to look</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--ink-500)]">
                Use the tabs above for your invoices, bills and statements. Everything updates the
                moment your accountant posts to the books — there is nothing to refresh or reconcile
                on your side.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
