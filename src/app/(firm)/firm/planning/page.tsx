import { requireFirmOwner } from "@/lib/auth";
import { listFirmClients, getFirmBooks } from "@/services/firms";
import { listFirmUsers } from "@/services/users";
import { listFirmBookCustomers, listFirmClientLinks, listFirmStaffRates, listFirmTime } from "@/services/firm-planning";
import { PageHeader } from "@/components/ui";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { linkFirmClientAction, setFirmStaffRateAction, recordFirmTimeAction, deleteFirmTimeAction, setFirmBudgetAction } from "./actions";

export default async function FirmPlanningPage({searchParams}:{searchParams:Promise<{error?:string;saved?:string}>}) {
  const owner=await requireFirmOwner();
  const today=todayIso();
  const [clients,members,books,customers,links,rates,time,query]=await Promise.all([
    listFirmClients(owner.firmId),listFirmUsers(owner.firmId),getFirmBooks(owner.firmId),
    listFirmBookCustomers(owner.firmId),listFirmClientLinks(owner.firmId),listFirmStaffRates(owner.firmId),
    listFirmTime(owner.firmId,`${today.slice(0,4)}-01-01`,today),searchParams,
  ]);
  const staff=members.filter(m=>["firm_owner","firm_admin","accountant_staff"].includes(m.role) && m.isActive);
  const activeClients=clients.filter(c=>c.isActive);
  const linked=new Map(links.map(x=>[x.clientEntityId,x.customerContactId]));
  const rateMap=new Map(rates.map(x=>[x.userId,x]));
  return <div className="fade-up">
    <PageHeader title="Firm planning" sub="Link firm invoices to clients, set staff costs, record time and plan monthly targets."><a href="/firm/reports" className="btn btn-secondary">View reports</a></PageHeader>
    {query.error && <div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    {query.saved && <div className="banner mb-4" role="status">Saved.</div>}
    {!books && <p className="banner banner-warn mb-4">Create firm books on the overview page before linking firm customers or setting budgets.</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card p-5"><h2 className="text-lg font-semibold">Client revenue links</h2>
        <p className="mb-4 mt-1 text-sm text-[var(--ink-500)]">Match each client to the customer used on invoices in the firm&apos;s own books. Only linked invoices appear in revenue by client.</p>
        {books && <a href={`/accountant/${books.id}/contacts`} className="mb-4 inline-block text-sm text-[var(--brand-700)] hover:underline">Create a customer in firm books →</a>}
        <div className="space-y-3">{activeClients.map(client=><form key={client.id} action={linkFirmClientAction} className="grid gap-2 border-t border-[var(--ink-100)] pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><input type="hidden" name="clientEntityId" value={client.id}/><span className="text-sm font-medium">{client.name}</span><label><span className="field-label">Firm books customer</span><select name="customerContactId" className="select" defaultValue={linked.get(client.id)??""}><option value="">Not linked</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><button className="btn btn-secondary btn-sm">Save</button></form>)}</div>
        {!activeClients.length && <p className="text-sm text-[var(--ink-500)]">No active clients.</p>}
      </section>
      <section className="card p-5"><h2 className="text-lg font-semibold">Team cost and capacity</h2>
        <p className="mb-4 mt-1 text-sm text-[var(--ink-500)]">Hourly cost is a planning rate. New time entries keep a snapshot of the rate used when they were recorded.</p>
        <div className="space-y-3">{staff.map(member=><form key={member.id} action={setFirmStaffRateAction} className="grid gap-2 border-t border-[var(--ink-100)] pt-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end"><input type="hidden" name="userId" value={member.id}/><span className="text-sm font-medium">{member.fullName}</span><label><span className="field-label">Cost / hour</span><input name="hourlyCost" type="number" min="0" step="0.01" defaultValue={rateMap.get(member.id)?.hourlyCost??""} className="input" required/></label><label><span className="field-label">Hours / week</span><input name="capacityHoursWeek" type="number" min="0.01" max="168" step="0.01" defaultValue={rateMap.get(member.id)?.capacityHoursWeek??"40"} className="input" required/></label><button className="btn btn-secondary btn-sm">Save</button></form>)}</div>
      </section>
      <section className="card p-5"><h2 className="text-lg font-semibold">Record client work</h2>
        <p className="mb-4 mt-1 text-sm text-[var(--ink-500)]">Set a team member&apos;s hourly cost above before recording their work.</p>
        <form action={recordFirmTimeAction} className="grid gap-4 sm:grid-cols-2">
          <label><span className="field-label">Client</span><select name="clientEntityId" className="select" required>{activeClients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label><span className="field-label">Team member</span><select name="userId" className="select" required>{staff.map(member=><option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
          <label><span className="field-label">Work date</span><input name="workDate" type="date" defaultValue={today} className="input" required/></label>
          <label><span className="field-label">Hours</span><input name="hours" type="number" min="0.01" max="24" step="0.01" className="input" required/></label>
          <label className="sm:col-span-2"><span className="field-label">Work description</span><input name="description" className="input" maxLength={1000} required/></label>
          <label className="flex items-center gap-2 text-sm"><input name="billable" value="true" type="checkbox" defaultChecked/> Billable client work</label>
          <div className="flex justify-end"><button className="btn btn-brand" disabled={!activeClients.length||!staff.length}>Record time</button></div>
        </form>
      </section>
      <section className="card p-5"><h2 className="text-lg font-semibold">Monthly firm budget</h2>
        <p className="mb-4 mt-1 text-sm text-[var(--ink-500)]">Compare targets with actual posted revenue and expenses in firm books. Currency: {books?.baseCurrency??"set up firm books first"}.</p>
        <form action={setFirmBudgetAction} className="grid gap-4 sm:grid-cols-2">
          <label><span className="field-label">Month</span><input name="month" type="month" defaultValue={today.slice(0,7)} className="input" required/></label>
          <label><span className="field-label">Revenue target</span><input name="revenueTarget" type="number" min="0" step="0.01" className="input" required/></label>
          <label><span className="field-label">Expense budget</span><input name="expenseBudget" type="number" min="0" step="0.01" className="input" required/></label>
          <div className="flex items-end"><button className="btn btn-brand" disabled={!books}>Save budget</button></div>
        </form>
      </section>
    </div>
    <section className="card mt-5 overflow-x-auto p-5"><h2 className="mb-3 text-lg font-semibold">Recent time entries</h2><table className="tbl"><thead><tr><th>Date</th><th>Client</th><th>Member</th><th>Description</th><th className="text-right">Hours</th><th className="text-right">Cost / hour</th><th>Billable</th><th></th></tr></thead><tbody>{time.map(entry=><tr key={entry.id}><td>{fmtDate(entry.work_date)}</td><td>{entry.client_name}</td><td>{entry.member_name}</td><td>{entry.description}</td><td className="td-num">{entry.hours}</td><td className="td-num">{fmtMoney(entry.hourly_cost)}</td><td>{entry.billable?"Yes":"No"}</td><td><form action={deleteFirmTimeAction}><input type="hidden" name="entryId" value={entry.id}/><button className="btn btn-ghost btn-sm">Remove</button></form></td></tr>)}</tbody></table>{!time.length && <p className="text-sm text-[var(--ink-500)]">No time recorded this year.</p>}</section>
  </div>;
}
