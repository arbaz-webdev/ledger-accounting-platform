"use client";

import { DocumentForm, type Option, type ItemOption } from "@/components/document-form";
import { createBusinessInvoiceAction } from "../actions";

export function NewBusinessInvoiceForm({
  entityId, customers, accounts, contactTerms, items, baseCurrency, currencies,
}: {
  entityId: string;
  customers: Option[];
  accounts: Option[];
  contactTerms: Record<string, number>;
  items: ItemOption[];
  baseCurrency: string;
  currencies: string[];
}) {
  return <DocumentForm
    entityId={entityId}
    variant="invoice"
    contacts={customers}
    accounts={accounts}
    contactTerms={contactTerms}
    items={items}
    baseCurrency={baseCurrency}
    currencies={currencies}
    onSubmit={(payload) => createBusinessInvoiceAction({
      entityId: payload.entityId,
      customerId: payload.contactId,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      notes: payload.notes,
      currency: payload.currency,
      postNow: payload.postNow,
      lines: payload.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        revenueAccountId: line.accountId,
        taxRate: line.taxRate,
        itemId: line.itemId || undefined,
      })),
    })}
  />;
}
