import { listFxRates, getBaseCurrency, foreignExposure, COMMON_CURRENCIES } from "@/services/fx";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconScale, IconPlus } from "@/components/icons";
import { setFxRateAction, deleteFxRateAction } from "./actions";

export default async function FxRatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { entityId } = await params;
  const { error } = await searchParams;
  const today = todayIso();

  const [base, rates, exposure] = await Promise.all([
    getBaseCurrency(entityId),
    listFxRates(entityId),
    foreignExposure(entityId, today),
  ]);

  // Latest rate per currency, for the "ruling today" summary
  const latest = new Map<string, (typeof rates)[number]>();
  for (const r of rates) {
    if (r.asOfDate > today) continue;
    const seen = latest.get(r.currency);
    if (!seen || r.asOfDate > seen.asOfDate) latest.set(r.currency, r);
  }
  const foreign = exposure.filter((e) => e.currency !== base);

  return (
    <div className="fade-up">
      <PageHeader
        title="Exchange rates"
        sub={`Base currency ${base}. Rates are units of ${base} per 1 unit of the foreign currency; documents book at the rate ruling on their date.`}
      />

      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      <form action={setFxRateAction} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="entityId" value={entityId} />
        <div className="w-32">
          <label className="field-label">Currency</label>
          <input
            name="currency"
            list="fx-currencies"
            required
            placeholder="EUR"
            maxLength={3}
            className="input acct uppercase"
          />
          <datalist id="fx-currencies">
            {COMMON_CURRENCIES.filter((c) => c !== base).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="w-44">
          <label className="field-label">Effective from</label>
          <input type="date" name="asOfDate" defaultValue={today} required className="input" />
        </div>
        <div className="w-40">
          <label className="field-label">Rate (1 unit = ? {base})</label>
          <input
            name="rate"
            inputMode="decimal"
            required
            placeholder="1.0850"
            className="input num text-right"
          />
        </div>
        <button className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          Save rate
        </button>
      </form>

      {latest.size > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[...latest.values()].map((r) => {
            const exp = foreign.filter((e) => e.currency === r.currency);
            return (
              <div key={r.currency} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-[var(--ink-900)]">
                    {r.currency} → {base}
                  </span>
                  <span className="num text-lg font-semibold text-[var(--brand-700)]">
                    {Number(r.rate)}
                  </span>
                </div>
                <div className="mt-0.5 text-[0.6875rem] text-[var(--ink-400)]">
                  ruling since {fmtDate(r.asOfDate)}
                </div>
                {exp.length > 0 && (
                  <div className="mt-2 space-y-0.5 border-t border-[var(--ink-100)] pt-2 text-[0.75rem] text-[var(--ink-500)]">
                    {exp.map((e) => (
                      <div key={e.kind} className="flex justify-between">
                        <span>{e.kind === "ar" ? "Open receivables" : "Open payables"}</span>
                        <span className="num">
                          {r.currency} {fmtMoney(e.openDoc)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card overflow-x-auto">
        {rates.length === 0 ? (
          <EmptyState
            icon={<IconScale className="h-5 w-5" />}
            title="No exchange rates yet"
            hint={`Add a rate to start invoicing or billing in a currency other than ${base}.`}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Currency</th>
                <th>Effective from</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="acct font-medium text-[var(--ink-800)]">{r.currency}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.asOfDate)}</td>
                  <td className="td-num">{Number(r.rate)}</td>
                  <td className="text-right">
                    <form action={deleteFxRateAction} className="inline">
                      <input type="hidden" name="entityId" value={entityId} />
                      <input type="hidden" name="rateId" value={r.id} />
                      <button className="btn btn-ghost btn-sm">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 text-[0.75rem] text-[var(--ink-400)]">
        Deleting a rate never changes posted entries — every document stores the rate it was booked
        at, and settling at a different rate posts a realised FX gain or loss.
      </p>
    </div>
  );
}
