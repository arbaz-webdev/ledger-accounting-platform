import { notFound } from "next/navigation";
import { requireFirmOwner } from "@/lib/auth";
import { getClientSubscriptionManagement } from "@/services/client-subscriptions";
import { PageHeader } from "@/components/ui";
import { saveClientSubscriptionAction } from "./actions";

export default async function ClientSubscriptionPage({ params, searchParams }: {
  params: Promise<{ entityId: string }>; searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const owner = await requireFirmOwner();
  const { entityId } = await params;
  const query = await searchParams;
  const data = await getClientSubscriptionManagement(owner.firmId,entityId).catch(() => null);
  if (!data) notFound();
  return <div className="fade-up">
    <PageHeader title={`${data.entity.name} subscription`} sub="Choose who manages this client's subscription and record its contract terms.">
      <a href="/firm/clients" className="btn btn-secondary">Back to clients</a>
    </PageHeader>
    {query.error && <div className="banner banner-error mb-4" role="alert">{query.error}</div>}
    {query.saved && <div className="banner mb-4" role="status">Subscription management saved.</div>}
    <form action={saveClientSubscriptionAction} className="card max-w-2xl space-y-4 p-5">
      <input type="hidden" name="entityId" value={entityId} />
      <label className="block"><span className="field-label">Managed by</span><select name="managedBy" defaultValue={data.managedBy} className="select"><option value="client">Client manages their own subscription</option><option value="firm">Our firm manages the client subscription</option></select></label>
      <div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">Contracted monthly fee</span><input name="monthlyFee" type="number" min="0" step="0.01" defaultValue={data.monthlyFee} className="input" /></label><label><span className="field-label">Fee currency</span><input name="currency" defaultValue={data.currency} minLength={3} maxLength={3} className="input" /></label></div>
      <label className="block"><span className="field-label">Next renewal date</span><input name="renewalOn" type="date" defaultValue={data.renewalOn} className="input" /></label>
      <label className="block"><span className="field-label">Notes</span><textarea name="notes" defaultValue={data.notes} className="input min-h-24" /></label>
      <button className="btn btn-brand">Save arrangement</button>
    </form>
    <p className="mt-3 max-w-2xl text-sm text-[var(--ink-500)]">This records the arrangement and fee. It does not charge the client or post revenue. Use the firm books to issue invoices and record payments.</p>
  </div>;
}
