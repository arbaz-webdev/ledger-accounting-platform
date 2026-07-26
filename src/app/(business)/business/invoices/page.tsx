import { guardPortal } from "@/lib/business-guard";
import { listInvoices } from "@/services/invoices";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconJournal } from "@/components/icons";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-draft",
  posted: "badge-info",
  paid: "badge-posted",
  void: "badge-voided",
};

export default async function PortalInvoicesPage() {
  const { entityId } = await guardPortal("sales");
  const invoices = (await listInvoices(entityId)).filter((i) => i.status !== "draft");
  const today = todayIso();
  const outstanding = invoices.reduce((s, i) => s + Number(i.outstanding), 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="fade-up">
        <PageHeader
          title="Invoices"
          sub={`${invoices.length} issued · ${fmtMoney(outstanding)} still owed to you`}
        />

        <div className="card overflow-x-auto">
          {invoices.length === 0 ? (
            <EmptyState
              icon={<IconJournal className="h-5 w-5" />}
              title="No invoices yet"
              hint="Invoices your accountant posts will appear here."
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
                {invoices.map((i) => {
                  const overdue = Number(i.outstanding) > 0 && i.dueDate < today;
                  return (
                    <tr key={i.id}>
                      <td className="acct font-medium text-[var(--ink-800)]">{i.invoiceNumber}</td>
                      <td>{i.customerName}</td>
                      <td className="whitespace-nowrap">{fmtDate(i.issueDate)}</td>
                      <td className="whitespace-nowrap">
                        {fmtDate(i.dueDate)}
                        {overdue && <span className="badge badge-voided ml-2">Overdue</span>}
                      </td>
                      <td className="td-num">{fmtMoney(i.total)}</td>
                      <td className="td-num font-medium">{fmtMoney(i.outstanding)}</td>
                      <td className="text-right">
                        <span className={`badge ${STATUS_BADGE[i.status] ?? "badge-neutral"}`}>
                          <span className="badge-dot" />
                          {i.status}
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
