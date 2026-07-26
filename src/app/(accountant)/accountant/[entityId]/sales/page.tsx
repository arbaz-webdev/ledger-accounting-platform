import { listInvoices } from "@/services/invoices";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconJournal, IconPlus } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
  void: "badge-voided",
};

export default async function InvoicesPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const invoices = await listInvoices(entityId);
  const today = todayIso();

  const outstandingTotal = invoices.reduce((s, i) => s + Number(i.outstanding), 0);

  return (
    <div className="fade-up">
      <PageHeader
        title="Sales invoices"
        sub={`${invoices.length} invoices · ${fmtMoney(outstandingTotal)} outstanding`}
      >
        <a href={`/accountant/${entityId}/sales/new`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New invoice
        </a>
      </PageHeader>

      <div className="card overflow-x-auto">
        {invoices.length === 0 ? (
          <EmptyState
            icon={<IconJournal className="h-5 w-5" />}
            title="No invoices yet"
            hint="Create your first invoice — posting it will debit Accounts Receivable and credit revenue automatically."
            action={
              <a href={`/accountant/${entityId}/sales/new`} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                New invoice
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="text-right">Total</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const overdue =
                  Number(inv.outstanding) > 0 && inv.dueDate < today && inv.status !== "draft";
                return (
                  <tr key={inv.id} className="tbl-row-link">
                    <td className="acct">
                      <a
                        href={`/accountant/${entityId}/sales/${inv.id}`}
                        className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                      >
                        {inv.invoiceNumber}
                      </a>
                    </td>
                    <td className="font-medium text-[var(--ink-800)]">{inv.customerName}</td>
                    <td className="whitespace-nowrap">{fmtDate(inv.issueDate)}</td>
                    <td className="whitespace-nowrap">
                      {fmtDate(inv.dueDate)}
                      {overdue && (
                        <span className="badge badge-voided ml-2">Overdue</span>
                      )}
                    </td>
                    <td className="td-num">{fmtMoney(inv.total)}</td>
                    <td className="td-num font-medium">{fmtMoney(inv.outstanding)}</td>
                    <td className="text-right">
                      <span className={`badge ${STATUS_BADGE[inv.status] ?? "badge-neutral"}`}>
                        <span className="badge-dot" />
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
