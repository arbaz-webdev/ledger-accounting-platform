import { requireFirmOwner } from "@/lib/auth";
import { firmOverview, listFirmClients, getFirmBooks } from "@/services/firms";
import { getFirmSubscription, firmUsage } from "@/services/subscriptions";
import { clientCashBalances, firmMonthlyPerformance, firmActivitySummary } from "@/services/firm-insights";
import { listFirmTeams } from "@/services/firm-teams";
import { parseCents, formatCents } from "@/lib/money";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { IconBuilding, IconPlus } from "@/components/icons";
import { createFirmBooksAction } from "./actions";

const STATUS_BADGE: Record<string, string> = { active: "badge-posted", trial: "badge-info", past_due: "badge-pending" };
function percent(value: bigint, max: bigint) { return max <= 0n || value <= 0n ? 0 : Number((value * 100n) / max); }

export default async function FirmOverviewPage({ searchParams }: { searchParams: Promise<{ error?: string; books?: string }> }) {
  const user = await requireFirmOwner();
  const query = await searchParams;
  const [overview, sub, usage, clients, books, teams] = await Promise.all([
    firmOverview(user.firmId), getFirmSubscription(user.firmId), firmUsage(user.firmId),
    listFirmClients(user.firmId), getFirmBooks(user.firmId), listFirmTeams(user.firmId),
  ]);
  const today = new Date().toISOString().slice(0,10);
  const monthStart = `${today.slice(0,7)}-01`;
  const [cash, activity, months] = await Promise.all([
    clientCashBalances(user.firmId,today), firmActivitySummary(user.firmId,monthStart,today),
    books ? firmMonthlyPerformance(books.id,today) : Promise.resolve([]),
  ]);
  const currencyTotals = new Map<string,bigint>();
  for (const row of cash) currencyTotals.set(row.base_currency,(currencyTotals.get(row.base_currency) ?? 0n) + parseCents(row.cash_balance));
  const maxCashByCurrency = new Map<string,bigint>();
  for (const row of cash) { const amount = parseCents(row.cash_balance); if (amount > (maxCashByCurrency.get(row.base_currency) ?? 0n)) maxCashByCurrency.set(row.base_currency,amount); }
  const performanceMax = months.reduce((max,m) => [parseCents(m.revenue),parseCents(m.expenses),max].reduce((a,b)=>a>b?a:b),0n);
  const teamMax = Math.max(1,...teams.map(team=>team.posted_entries));
  const current = months.at(-1);
  const limit = (used: number, max: number | null) => max === null ? `${used} / ∞` : `${used} / ${max}`;

  return <div className="fade-up">
    <PageHeader title="Firm overview" sub="Your practice and its clients at a glance."><a href="/firm/clients" className="btn btn-primary"><IconPlus className="h-4 w-4" /> Add client</a></PageHeader>
    {query.error && <div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label="Clients" value={limit(usage.entities,usage.maxEntities)} hint="active client businesses" accent={usage.entitiesAtLimit?"negative":undefined} />
      <StatCard label="Client cash balances" value={`${currencyTotals.size} ${currencyTotals.size===1?"currency":"currencies"}`} hint={currencyTotals.size ? [...currencyTotals].map(([currency,amount])=>`${currency} ${fmtMoney(formatCents(amount))}`).join(" · ") : "No active clients"} />
      <StatCard label="Team performance" value={`${activity.client_entries} entries`} hint="posted in client books this month" />
    </div>
    {sub && <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><span className={`badge ${STATUS_BADGE[sub.status] ?? "badge-neutral"}`}>{sub.status.replace(/_/g," ")}</span><span className="text-sm text-[var(--ink-500)]">{sub.plan.name} · {fmtMoney(sub.plan.monthlyPrice)}/mo</span></div><a href="/firm/subscription" className="btn btn-secondary btn-sm">Plan details</a></div>}
    {!books ? <section className="card mt-5 p-5"><h2 className="text-lg font-semibold">Set up your firm&apos;s own books</h2><p className="mt-1 text-sm text-[var(--ink-500)]">Your practice needs its own ledger for revenue, expenses and profit. It stays separate from every client and does not use a client slot on your plan.</p><form action={createFirmBooksAction} className="mt-4 flex flex-wrap items-end gap-3"><label><span className="field-label">Firm books currency</span><select name="currency" className="select" defaultValue="USD"><option value="USD">USD</option><option value="PKR">PKR</option><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="AED">AED</option></select></label><button className="btn btn-brand">Create firm books</button></form><p className="mt-2 text-xs text-[var(--ink-500)]">Choose carefully; changing the base currency after posting transactions requires a conversion.</p></section> : <div className="card mt-5 flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold">Firm books · {books.baseCurrency}</p><p className="text-xs text-[var(--ink-500)]">Revenue, expenses and profit below come only from these books.</p></div><a href={`/accountant/${books.id}`} className="btn btn-brand btn-sm">Open firm books →</a></div>}
    <div className="mt-5 grid gap-4 lg:grid-cols-3">
      <section className="card p-5"><h2 className="text-sm font-semibold">Firm performance</h2><p className="mb-4 text-xs text-[var(--ink-500)]">Monthly revenue and expenses · {books?.baseCurrency ?? "firm books not set up"}</p>{months.length ? <div className="space-y-3">{months.map(m=><div key={m.from}><div className="flex justify-between text-xs"><span>{m.label}</span><span className="num">{fmtMoney(m.revenue)} / {fmtMoney(m.expenses)}</span></div><div className="mt-1 space-y-1"><div className="h-2 rounded bg-[var(--brand-500)]" style={{width:`${percent(parseCents(m.revenue),performanceMax)}%`}} title={`Revenue ${m.revenue}`} /><div className="h-2 rounded bg-[var(--ink-300)]" style={{width:`${percent(parseCents(m.expenses),performanceMax)}%`}} title={`Expenses ${m.expenses}`} /></div></div>)}</div> : <p className="text-sm text-[var(--ink-500)]">Create firm books to see this chart.</p>}<p className="mt-4 text-xs text-[var(--ink-500)]">Green: revenue · grey: expenses{current ? ` · this month profit ${fmtMoney(current.profit)}` : ""}</p></section>
      <section className="card p-5"><h2 className="text-sm font-semibold">Client cash and bank balances</h2><p className="mb-4 text-xs text-[var(--ink-500)]">As of {fmtDate(today)} · each client in its own currency</p>{cash.length ? <div className="space-y-3">{cash.map(row=><div key={row.id}><div className="flex justify-between gap-2 text-xs"><span className="truncate">{row.name}</span><span className="num whitespace-nowrap">{row.base_currency} {fmtMoney(row.cash_balance)}</span></div><div className="mt-1 h-2 rounded bg-[var(--brand-500)]" style={{width:`${percent(parseCents(row.cash_balance),maxCashByCurrency.get(row.base_currency) ?? 0n)}%`}} /></div>)}</div> : <p className="text-sm text-[var(--ink-500)]">No client balances yet.</p>}<p className="mt-4 text-xs text-[var(--ink-500)]">Balances in different currencies are never added together.</p></section>
      <section className="card p-5"><h2 className="text-sm font-semibold">Team performance</h2><p className="mb-4 text-xs text-[var(--ink-500)]">Current team members&apos; posted client entries</p>{teams.length ? <div className="space-y-3">{teams.map(team=><div key={team.id}><div className="flex justify-between text-xs"><span>{team.name} ({team.member_count})</span><span>{team.posted_entries} entries</span></div><div className="mt-1 h-2 rounded bg-amber-600" style={{width:`${Math.round(team.posted_entries*100/teamMax)}%`}} /></div>)}</div> : <p className="text-sm text-[var(--ink-500)]">Create teams to compare work by group.</p>}<p className="mt-4 text-xs text-[var(--ink-500)]">Activity count only; it is not a quality rating.</p></section>
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><a href="/firm/team" className="card card-hover block p-5"><h2 className="font-semibold">Team management →</h2><p className="mt-1 text-sm text-[var(--ink-500)]">Group members, review access and manage accounts.</p></a><a href="/firm/clients" className="card card-hover block p-5"><h2 className="font-semibold">Client management →</h2><p className="mt-1 text-sm text-[var(--ink-500)]">Open books, review subscriptions and manage clients.</p></a></div>
    <div className="card mt-5 overflow-x-auto"><div className="flex items-center justify-between border-b border-[var(--ink-100)] px-5 py-3"><h2 className="text-sm font-semibold">Client data</h2><a href="/firm/clients" className="text-sm text-[var(--brand-700)] hover:underline">Manage</a></div>{clients.length ? <table className="tbl"><thead><tr><th>Client</th><th>Currency</th><th className="text-right">Entries</th><th className="text-right">Staff</th><th className="text-right">Books</th></tr></thead><tbody>{clients.map(c=><tr key={c.id} className={c.isActive?"":"opacity-55"}><td className="font-medium">{c.name}</td><td className="acct">{c.baseCurrency}</td><td className="td-num">{c.postedEntries}</td><td className="td-num">{c.assignedUsers}</td><td className="text-right">{c.isActive?<a href={`/accountant/${c.id}`} className="btn btn-ghost btn-sm">Open →</a>:<span className="badge badge-neutral">archived</span>}</td></tr>)}</tbody></table> : <EmptyState icon={<IconBuilding className="h-5 w-5" />} title="No clients yet" hint="Add your first client business to begin." />}</div>
  </div>;
}
