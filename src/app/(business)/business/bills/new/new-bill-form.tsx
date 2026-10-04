"use client";

import { DocumentForm, type Option, type ItemOption } from "@/components/document-form";
import { createBusinessBillAction } from "../actions";

export function NewBusinessBillForm({
  entityId, suppliers, accounts, contactTerms, items, baseCurrency, currencies, inventoryAccountId,
}: {
  entityId: string;
  suppliers: Option[];
  accounts: Option[];
  contactTerms: Record<string, number>;
  items: ItemOption[];
  baseCurrency: string;
  currencies: string[];
  inventoryAccountId?: string;
}) {
  return <DocumentForm
    entityId={entityId}
    variant="bill"
    contacts={suppliers}
    accounts={accounts}
    contactTerms={contactTerms}
    items={items}
    baseCurrency={baseCurrency}
    currencies={currencies}
    inventoryAccountId={inventoryAccountId}
    onSubmit={(payload) => createBusinessBillAction({
      entityId: payload.entityId,
      supplierId: payload.contactId,
      supplierReference: payload.supplierReference,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      notes: payload.notes,
      currency: payload.currency,
      postNow: payload.postNow,
      lines: payload.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        expenseAccountId: line.accountId,
        taxRate: line.taxRate,
        itemId: line.itemId || undefined,
      })),
    })}
  />;
}
