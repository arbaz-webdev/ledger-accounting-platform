import { listBills } from "@/services/bills";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconCash, IconPlus } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
  void: "badge-voided",
};

export default async function BillsPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const bills = await listBills(entityId);
  const today = todayIso();
  const outstandingTotal = bills.reduce((s, b) => s + Number(b.outstanding), 0);

  return (
    <div className="fade-up">
      <PageHeader
        title="Purchase bills"
        sub={`${bills.length} bills · ${fmtMoney(outstandingTotal)} outstanding`}
      >
        <a href={`/accountant/${entityId}/purchases/new`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          New bill
        </a>
      </PageHeader>

      <div className="card overflow-x-auto">
        {bills.length === 0 ? (
          <EmptyState
            icon={<IconCash className="h-5 w-5" />}
            title="No bills yet"
            hint="Enter a supplier bill — posting it will debit the expense and credit Accounts Payable."
            action={
              <a href={`/accountant/${entityId}/purchases/new`} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                New bill
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Supplier</th>
                <th>Their ref</th>
                <th>Due</th>
                <th className="text-right">Total</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => {
                const overdue =
                  Number(bill.outstanding) > 0 && bill.dueDate < today && bill.status !== "draft";
                return (
                  <tr key={bill.id} className="tbl-row-link">
                    <td className="acct">
                      <a
                        href={`/accountant/${entityId}/purchases/${bill.id}`}
                        className="font-medium text-[var(--ink-700)] hover:text-[var(--brand-700)] hover:underline"
                      >
                        {bill.billNumber}
                      </a>
                    </td>
                    <td className="font-medium text-[var(--ink-800)]">{bill.supplierName}</td>
                    <td className="acct">{bill.supplierReference ?? ""}</td>
                    <td className="whitespace-nowrap">
                      {fmtDate(bill.dueDate)}
                      {overdue && <span className="badge badge-voided ml-2">Overdue</span>}
                    </td>
                    <td className="td-num">{fmtMoney(bill.total)}</td>
                    <td className="td-num font-medium">{fmtMoney(bill.outstanding)}</td>
                    <td className="text-right">
                      <span className={`badge ${STATUS_BADGE[bill.status] ?? "badge-neutral"}`}>
                        <span className="badge-dot" />
                        {bill.status}
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
