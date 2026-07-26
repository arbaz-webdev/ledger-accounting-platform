import { listContacts } from "@/services/contacts";
import { listAccounts } from "@/services/coa";
import { listItems } from "@/services/inventory";
import { getBaseCurrency, listEntityCurrencies } from "@/services/fx";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding } from "@/components/icons";
import { NewInvoiceForm } from "./new-invoice-form";

export default async function NewInvoicePage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const [customers, accounts, items, baseCurrency, currencies] = await Promise.all([
    listContacts(entityId, "customer"),
    listAccounts(entityId),
    listItems(entityId, { activeOnly: true }),
    getBaseCurrency(entityId),
    listEntityCurrencies(entityId),
  ]);

  const activeCustomers = customers.filter((c) => c.isActive);
  // Revenue-type accounts are the sensible default for invoice lines
  const revenueAccounts = accounts.filter(
    (a) => a.isActive && (a.type === "revenue" || a.type === "other_income")
  );

  if (activeCustomers.length === 0) {
    return (
      <div className="fade-up">
        <PageHeader title="New invoice" />
        <div className="card">
          <EmptyState
            icon={<IconBuilding className="h-5 w-5" />}
            title="Add a customer first"
            hint="Invoices need someone to bill. Create a customer, then come back."
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
        title="New invoice"
        sub="Posting debits Accounts Receivable and credits revenue and sales tax via your account mappings."
      />
      <NewInvoiceForm
        entityId={entityId}
        customers={activeCustomers.map((c) => ({ id: c.id, label: c.name }))}
        contactTerms={Object.fromEntries(activeCustomers.map((c) => [c.id, c.paymentTermsDays]))}
        accounts={revenueAccounts.map((a) => ({
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
      />
    </div>
  );
}
