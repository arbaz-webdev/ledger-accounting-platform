import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { listFxRates, COMMON_CURRENCIES } from "@/services/fx";
import { PageHeader } from "@/components/ui";
import { fmtDate, todayIso } from "@/lib/format";
import { setBusinessFxRateAction } from "./actions";

export default async function BusinessFxRatesPage({searchParams}:{searchParams:Promise<{error?:string;saved?:string}>}) {
  const ctx=await portalContext();
  if (ctx.user.role!=="business_admin") redirect("/business?denied=fx-rates");
  const [rates,query]=await Promise.all([listFxRates(ctx.entityId),searchParams]);
  return <main className="mx-auto max-w-5xl px-6 py-8">
    <PageHeader title="Exchange rates" sub={`1 unit of a foreign currency equals the entered amount of ${ctx.baseCurrency}. New documents use the latest rate effective on their date.`}/>
    {query.error&&<div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    {query.saved&&<div className="banner mb-4" role="status">Exchange rate saved.</div>}
    <form action={setBusinessFxRateAction} className="card mb-5 flex flex-wrap items-end gap-3 p-5">
      <label><span className="field-label">Foreign currency</span><input name="currency" list="currencies" maxLength={3} className="input uppercase" required/></label>
      <datalist id="currencies">{COMMON_CURRENCIES.filter(currency=>currency!==ctx.baseCurrency).map(currency=><option key={currency} value={currency}/>)}</datalist>
      <label><span className="field-label">Effective date</span><input name="asOfDate" type="date" defaultValue={todayIso()} className="input" required/></label>
      <label><span className="field-label">Rate in {ctx.baseCurrency}</span><input name="rate" type="number" min="0.00000001" step="0.00000001" className="input" required/></label>
      <button className="btn btn-brand">Save rate</button>
    </form>
    <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>Currency</th><th>Effective from</th><th className="text-right">Rate</th></tr></thead><tbody>
      {rates.map(rate=><tr key={rate.id}><td>{rate.currency}</td><td>{fmtDate(rate.asOfDate)}</td><td className="td-num">{rate.rate}</td></tr>)}
    </tbody></table>{!rates.length&&<p className="p-4 text-sm text-[var(--ink-500)]">No foreign exchange rates entered.</p>}</div>
  </main>;
}
