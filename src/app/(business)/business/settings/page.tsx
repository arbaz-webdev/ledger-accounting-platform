import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { getBusinessSettings } from "@/services/business-settings";
import { PageHeader } from "@/components/ui";
import { saveBusinessSettingsAction } from "./actions";

export default async function BusinessSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const ctx = await portalContext();
  if (ctx.user.role !== "business_admin") redirect("/business?denied=settings");
  const [settings, params] = await Promise.all([getBusinessSettings(ctx.entityId), searchParams]);
  return <main className="mx-auto max-w-4xl px-6 py-8">
    <PageHeader title="Company settings" sub="Your business profile and document defaults." />
    {params.error && <div className="banner banner-error mb-4" role="alert">{params.error}</div>}
    {params.saved && <div className="banner mb-4" role="status">Settings saved.</div>}
    <form action={saveBusinessSettingsAction} className="space-y-6">
      <section className="card space-y-4 p-5"><h2 className="text-lg font-semibold">Company profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" name="name" value={settings.name} required />
          <Field label="Legal name" name="legalName" value={settings.legalName ?? ""} />
          <Field label="Legal structure" name="legalStructure" value={settings.legalStructure} />
          <Field label="Tax ID / registration" name="taxIdentifiers" value={settings.taxIdentifiers} />
          <label><span className="field-label">Fiscal year starts</span><select name="fiscalYearStartMonth" className="select" defaultValue={settings.fiscalYearStartMonth}>{["January","February","March","April","May","June","July","August","September","October","November","December"].map((month, i) => <option key={month} value={i + 1}>{month}</option>)}</select></label>
          <label><span className="field-label">Brand color</span><input name="brandAccent" type="color" className="input h-10" defaultValue={settings.brandAccent} /></label>
        </div>
        <label className="block"><span className="field-label">Registered address</span><textarea name="registeredAddress" className="input min-h-20" defaultValue={settings.registeredAddress} /></label>
        <p className="text-sm text-[var(--ink-500)]">Base currency: {settings.baseCurrency}. Accounting basis: accrual. Fiscal year start cannot change after posting begins.</p>
      </section>
      <section className="card space-y-4 p-5"><h2 className="text-lg font-semibold">Invoices and bills</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Invoice prefix" name="invoicePrefix" value={settings.invoicePrefix} required />
          <Field label="Bill prefix" name="billPrefix" value={settings.billPrefix} required />
          <label><span className="field-label">Default tax rate (%)</span><input name="defaultTaxRate" type="number" step="0.0001" min="0" max="100" className="input" defaultValue={settings.defaultTaxRate} /></label>
        </div>
        <Field label="Invoice header" name="invoiceHeader" value={settings.invoiceHeader} />
        <label className="block"><span className="field-label">Default invoice terms</span><textarea name="invoiceTerms" className="input min-h-20" defaultValue={settings.invoiceTerms} /></label>
        <p className="text-sm text-[var(--ink-500)]">New document numbers use these prefixes. Existing numbers stay the same.</p>
      </section>
      <section className="card space-y-4 p-5"><h2 className="text-lg font-semibold">Email templates</h2>
        <p className="text-sm text-[var(--ink-500)]">Templates can be saved now. Sending invoices and reminders needs an email service account.</p>
        <label className="block"><span className="field-label">Invoice email</span><textarea name="invoiceEmailTemplate" className="input min-h-24" defaultValue={settings.invoiceEmailTemplate} /></label>
        <label className="block"><span className="field-label">Payment reminder</span><textarea name="reminderEmailTemplate" className="input min-h-24" defaultValue={settings.reminderEmailTemplate} /></label>
      </section>
      <button className="btn btn-brand">Save settings</button>
    </form>
    <section className="card mt-6 space-y-2 p-5"><h2 className="text-lg font-semibold">Integrations awaiting setup</h2>
      <p className="text-sm text-[var(--ink-600)]">Stripe and PayPal payment links, automated email, bank feeds, and off-site backups need provider accounts and credentials before activation.</p>
    </section>
  </main>;
}

function Field({ label, name, value, required = false }: { label: string; name: string; value: string; required?: boolean }) {
  return <label className="block"><span className="field-label">{label}</span><input name={name} className="input" defaultValue={value} required={required} /></label>;
}
