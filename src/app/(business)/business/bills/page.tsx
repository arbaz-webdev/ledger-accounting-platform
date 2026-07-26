import { guardPortal } from "@/lib/business-guard";
import { listBills } from "@/services/bills";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconCash } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
  void: "badge-voided",
};

export default async function PortalBillsPage() {
  const { entityId } = await guardPortal("purchases");
  const bills = (await listBills(entityId)).filter((b) => b.status !== "draft");
  const today = todayIso();
  const outstanding = bills.reduce((s, b) => s + Number(b.outstanding), 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="fade-up">
        <PageHeader
          title="Bills"
          sub={`${bills.length} recorded · ${fmtMoney(outstanding)} still to pay`}
        />

        <div className="card overflow-x-auto">
          {bills.length === 0 ? (
            <EmptyState
              icon={<IconCash className="h-5 w-5" />}
              title="No bills yet"
              hint="Supplier bills your accountant posts will appear here."
            />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Supplier</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => {
                  const overdue = Number(b.outstanding) > 0 && b.dueDate < today;
                  return (
                    <tr key={b.id}>
                      <td className="acct font-medium text-[var(--ink-800)]">{b.billNumber}</td>
                      <td>{b.supplierName}</td>
                      <td className="whitespace-nowrap">{fmtDate(b.issueDate)}</td>
                      <td className="whitespace-nowrap">
                        {fmtDate(b.dueDate)}
                        {overdue && <span className="badge badge-voided ml-2">Overdue</span>}
                      </td>
                      <td className="td-num">{fmtMoney(b.total)}</td>
                      <td className="td-num font-medium">{fmtMoney(b.outstanding)}</td>
                      <td className="text-right">
                        <span className={`badge ${STATUS_BADGE[b.status] ?? "badge-neutral"}`}>
                          <span className="badge-dot" />
                          {b.status}
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
    </main>
  );
}
