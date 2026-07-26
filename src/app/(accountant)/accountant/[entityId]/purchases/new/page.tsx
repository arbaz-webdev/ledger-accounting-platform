import { listContacts } from "@/services/contacts";
import { listAccounts } from "@/services/coa";
import { listItems } from "@/services/inventory";
import { getBaseCurrency, listEntityCurrencies } from "@/services/fx";
import { resolveMapping } from "@/services/mappings";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding } from "@/components/icons";
import { NewBillForm } from "./new-bill-form";

export default async function NewBillPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const [suppliers, accounts, items, baseCurrency, currencies, inventoryAccountId] =
    await Promise.all([
      listContacts(entityId, "supplier"),
      listAccounts(entityId),
      listItems(entityId, { activeOnly: true }),
      getBaseCurrency(entityId),
      listEntityCurrencies(entityId),
      resolveMapping(entityId, "inventory_asset").catch(() => undefined),
    ]);

  const activeSuppliers = suppliers.filter((c) => c.isActive);
  // Bills usually hit COGS, expenses or assets (e.g. inventory, fixed assets)
  const expenseAccounts = accounts.filter(
    (a) =>
      a.isActive &&
      ["cogs", "expense", "other_expense", "asset", "tax"].includes(a.type)
  );

  if (activeSuppliers.length === 0) {
    return (
      <div className="fade-up">
        <PageHeader title="New bill" />
        <div className="card">
          <EmptyState
            icon={<IconBuilding className="h-5 w-5" />}
            title="Add a supplier first"
            hint="Bills need a supplier. Create one, then come back."
            action={
              <a href={`/accountant/${entityId}/contacts`} className="btn btn-primary btn-sm">
                Go to contacts
              </a>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageHeader
        title="New bill"
        sub="Posting debits the expense (and input tax) and credits Accounts Payable."
      />
      <NewBillForm
        entityId={entityId}
        suppliers={activeSuppliers.map((c) => ({ id: c.id, label: c.name }))}
        contactTerms={Object.fromEntries(activeSuppliers.map((c) => [c.id, c.paymentTermsDays]))}
        accounts={expenseAccounts.map((a) => ({
          id: a.id,
          label: `${a.accountNumber} — ${a.name}`,
        }))}
        items={items.map((it) => ({
          id: it.id,
          label: `${it.sku} — ${it.name}`,
          salesPrice: it.salesPrice,
        }))}
        baseCurrency={baseCurrency}
        currencies={currencies}
        inventoryAccountId={inventoryAccountId}
      />
    </div>
  );
}
