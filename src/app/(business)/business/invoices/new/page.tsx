import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { hasModule } from "@/services/permissions";
import { listContacts } from "@/services/contacts";
import { listAccounts } from "@/services/coa";
import { listItems } from "@/services/inventory";
import { listEntityCurrencies } from "@/services/fx";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding } from "@/components/icons";
import { NewBusinessInvoiceForm } from "./new-invoice-form";

export default async function NewBusinessInvoicePage() {
  const ctx = await portalContext();
  if (!(await hasModule(ctx.user, ctx.entityId, "sales", "edit"))) redirect("/business?denied=sales");
  const { entityId } = ctx;
  const [customers, accounts, items, currencies] = await Promise.all([
    listContacts(entityId, "customer"),
    listAccounts(entityId),
    listItems(entityId, { activeOnly: true }),
    listEntityCurrencies(entityId),
  ]);
  const activeCustomers = customers.filter((customer) => customer.isActive);
  const revenueAccounts = accounts.filter((account) => account.isActive && (account.type === "revenue" || account.type === "other_income"));
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="New invoice" sub="Create a draft or post it to your books." />
    {activeCustomers.length === 0 ? <div className="card"><EmptyState
      icon={<IconBuilding className="h-5 w-5" />}
      title="Add a customer first"
      hint="An invoice needs a customer before it can be created."
    /></div> : <NewBusinessInvoiceForm
      entityId={entityId}
      customers={activeCustomers.map((customer) => ({ id: customer.id, label: customer.name }))}
      contactTerms={Object.fromEntries(activeCustomers.map((customer) => [customer.id, customer.paymentTermsDays]))}
      accounts={revenueAccounts.map((account) => ({ id: account.id, label: `${account.accountNumber} — ${account.name}` }))}
      items={items.map((item) => ({ id: item.id, label: `${item.sku} — ${item.name}`, salesPrice: item.salesPrice }))}
      baseCurrency={ctx.baseCurrency}
      currencies={currencies}
    />}
  </main>;
}
