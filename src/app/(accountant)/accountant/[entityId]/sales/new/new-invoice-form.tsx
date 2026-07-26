"use client";

import { DocumentForm, type Option, type ItemOption } from "@/components/document-form";
import { createInvoiceAction } from "../actions";

export function NewInvoiceForm({
  entityId,
  customers,
  accounts,
  contactTerms,
  items,
  baseCurrency,
  currencies,
}: {
  entityId: string;
  customers: Option[];
  accounts: Option[];
  contactTerms: Record<string, number>;
  items: ItemOption[];
  baseCurrency: string;
  currencies: string[];
}) {
  return (
    <DocumentForm
      entityId={entityId}
      variant="invoice"
      contacts={customers}
      accounts={accounts}
      contactTerms={contactTerms}
      items={items}
      baseCurrency={baseCurrency}
      currencies={currencies}
      onSubmit={(payload) =>
        createInvoiceAction({
          entityId: payload.entityId,
          customerId: payload.contactId,
          issueDate: payload.issueDate,
          dueDate: payload.dueDate,
          notes: payload.notes,
          currency: payload.currency,
          postNow: payload.postNow,
          lines: payload.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            revenueAccountId: l.accountId,
            taxRate: l.taxRate,
            itemId: l.itemId || undefined,
          })),
        })
      }
    />
  );
}
