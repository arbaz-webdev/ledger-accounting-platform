import { redirect } from "next/navigation";
import { guardPortal } from "@/lib/business-guard";
import { listAccounts } from "@/services/coa";
import { PageHeader } from "@/components/ui";
import { todayIso } from "@/lib/format";
import { postQuickTransactionAction, postManualJournalAction } from "./actions";

export default async function BusinessTransactionsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const ctx = await guardPortal("journal");
  if (ctx.user.role !== "business_admin") redirect("/business?denied=journal");
  const [accounts, query] = await Promise.all([listAccounts(ctx.entityId),searchParams]);
  const active = accounts.filter(a => a.isActive);
  const banks = active.filter(a => a.type === "asset" && a.subType === "cash_and_bank");
  const option = (a: typeof active[number]) => <option key={a.id} value={a.id}>{a.accountNumber} · {a.name}</option>;
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="Post transaction" sub="Record bank movements and balanced manual entries in this business's books." />
    {query.error && <div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    {query.saved && <div className="banner mb-4" role="status">Transaction posted.</div>}
    <div className="grid gap-5 lg:grid-cols-2">
      <form action={postQuickTransactionAction} className="card space-y-4 p-5">
        <div><h2 className="text-lg font-semibold">Bank transaction</h2><p className="mt-1 text-sm text-[var(--ink-500)]">Use the invoice or bill page for customer payments and supplier payments.</p></div>
        <label className="block"><span className="field-label">Type</span><select name="kind" className="select" required><option value="transfer">Transfer between cash/bank accounts</option><option value="deposit">Other bank deposit</option><option value="expense">Expense paid from bank</option><option value="receipt">Other income receipt</option></select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="field-label">Date</span><input name="date" type="date" defaultValue={todayIso()} className="input" required /></label><label><span className="field-label">Amount · {ctx.baseCurrency}</span><input name="amount" type="number" min="0.01" step="0.01" className="input" required /></label></div>
        <label className="block"><span className="field-label">Cash or bank account</span><select name="bankAccountId" className="select" required>{banks.map(option)}</select></label>
        <label className="block"><span className="field-label">Other account</span><select name="counterAccountId" className="select" required><option value="">Select account</option>{active.map(option)}</select></label>
        <label className="block"><span className="field-label">Description</span><input name="description" className="input" maxLength={900} required /></label>
        <label className="block"><span className="field-label">Reference</span><input name="reference" className="input" maxLength={200} /></label>
        <button className="btn btn-brand">Post bank transaction</button>
      </form>
      <form action={postManualJournalAction} className="card space-y-4 p-5">
        <div><h2 className="text-lg font-semibold">Manual journal entry</h2><p className="mt-1 text-sm text-[var(--ink-500)]">Enter at least two lines. Debits and credits must match. AR, AP and retained earnings use their dedicated workflows.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="field-label">Date</span><input name="date" type="date" defaultValue={todayIso()} className="input" required /></label><label><span className="field-label">Reference</span><input name="reference" className="input" maxLength={200} /></label></div>
        <label className="block"><span className="field-label">Description</span><input name="description" className="input" maxLength={1000} required /></label>
        <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody>{Array.from({length:6},(_,i)=><tr key={i}><td><select name={`accountId${i}`} className="select min-w-48"><option value="">Select</option>{active.map(option)}</select><input name={`lineDescription${i}`} className="input mt-1 min-w-48" placeholder="Line note" maxLength={500} /></td><td><input name={`debit${i}`} type="number" min="0" step="0.01" className="input min-w-24 text-right" /></td><td><input name={`credit${i}`} type="number" min="0" step="0.01" className="input min-w-24 text-right" /></td></tr>)}</tbody></table></div>
        <button className="btn btn-brand">Post journal entry</button>
      </form>
    </div>
  </main>;
}
