import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { hasModule } from "@/services/permissions";
import { listContacts } from "@/services/contacts";
import { listAccounts } from "@/services/coa";
import { listItems } from "@/services/inventory";
import { listEntityCurrencies } from "@/services/fx";
import { getBusinessSettings } from "@/services/business-settings";
import { resolveMapping } from "@/services/mappings";
import { allowsBillCoding } from "@/lib/account-policy";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding } from "@/components/icons";
import { NewBusinessBillForm } from "./new-bill-form";

export default async function NewBusinessBillPage() {
  const ctx = await portalContext();
  if (!(await hasModule(ctx.user, ctx.entityId, "purchases", "edit"))) redirect("/business?denied=purchases");
  const { entityId } = ctx;
  const [suppliers, accounts, items, currencies, inventoryAccountId, settings] = await Promise.all([
    listContacts(entityId, "supplier"),
    listAccounts(entityId),
    listItems(entityId, { activeOnly: true }),
    listEntityCurrencies(entityId),
    resolveMapping(entityId, "inventory_asset").catch(() => undefined),
    getBusinessSettings(entityId),
  ]);
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="New bill" sub="Create a supplier bill as a draft or post it to your books." />
    {activeSuppliers.length === 0 ? <div className="card"><EmptyState
      icon={<IconBuilding className="h-5 w-5" />}
      title="Add a supplier first"
      hint="A bill needs a supplier before it can be created."
      action={<a href="/business/contacts" className="btn btn-brand">Add supplier</a>}
    /></div> : <NewBusinessBillForm
      entityId={entityId}
      suppliers={activeSuppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
      contactTerms={Object.fromEntries(activeSuppliers.map((supplier) => [supplier.id, supplier.paymentTermsDays]))}
      accounts={accounts.filter(allowsBillCoding).map((account) => ({ id: account.id, label: `${account.accountNumber} — ${account.name}` }))}
      items={items.filter((item) => !item.isService).map((item) => ({ id: item.id, label: `${item.sku} — ${item.name}`, salesPrice: item.salesPrice }))}
      baseCurrency={ctx.baseCurrency}
      currencies={currencies}
      inventoryAccountId={inventoryAccountId}
      defaultTaxRate={settings.defaultTaxRate}
    />}
  </main>;
}
