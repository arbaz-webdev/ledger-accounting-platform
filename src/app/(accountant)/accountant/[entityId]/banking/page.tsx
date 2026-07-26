import { listBankAccounts, listImportBatches, listBankTransactions, countPostedFromBank } from "@/services/bank-import";
import { listReconciliations } from "@/services/bank-recon";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import { IconBank, IconPlus, IconRows, IconCheck } from "@/components/icons";

export default async function BankingHubPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;

  const [accounts, batches, openTxns, postedCount, recons] = await Promise.all([
    listBankAccounts(entityId),
    listImportBatches(entityId),
    listBankTransactions(entityId, { status: "open" }),
    countPostedFromBank(entityId),
    listReconciliations(entityId),
  ]);

  const uncategorised = openTxns.filter((t) => !t.categoryAccountId).length;
  const flagged = openTxns.filter((t) => t.possibleDuplicate).length;

  return (
    <div className="fade-up">
      <PageHeader
        title="Banking"
        sub="Import statements, categorise transactions and reconcile to the bank."
      >
        <a href={`/accountant/${entityId}/banking/rules`} className="btn btn-secondary">
          Rules
        </a>
        <a href={`/accountant/${entityId}/banking/import`} className="btn btn-primary">
          <IconPlus className="h-4 w-4" />
          Import statement
        </a>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Awaiting review"
          value={String(openTxns.length)}
          hint={`${uncategorised} uncategorised`}
          accent={openTxns.length > 0 ? "brand" : undefined}
        />
        <StatCard label="Possible duplicates" value={String(flagged)} accent={flagged > 0 ? "negative" : undefined} />
        <StatCard label="Posted from bank" value={String(postedCount)} hint="journal entries" />
        <StatCard label="Bank accounts" value={String(accounts.length)} />
      </div>

      {openTxns.length > 0 && (
        <div className="banner banner-warn mt-4">
          <span>
            {openTxns.length} imported transaction{openTxns.length === 1 ? "" : "s"} still need
            reviewing before they reach the ledger.{" "}
            <a
              href={`/accountant/${entityId}/banking/review`}
              className="font-medium underline underline-offset-2"
            >
              Open the review queue →
            </a>
          </span>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Bank accounts */}
        <div className="card overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Bank accounts</h2>
          </div>
          {accounts.length === 0 ? (
            <EmptyState
              icon={<IconBank className="h-5 w-5" />}
              title="No bank accounts found"
              hint="Mark a chart-of-accounts asset in the 1000–1099 range as cash & bank."
            />
          ) : (
            <table className="tbl">
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="acct mr-2">{a.number}</span>
                      <span className="font-medium text-[var(--ink-800)]">{a.name}</span>
                    </td>
                    <td className="text-right">
                      <a
                        href={`/accountant/${entityId}/banking/reconcile?account=${a.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Reconcile
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent reconciliations */}
        <div className="card overflow-hidden">
          <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">Recent reconciliations</h2>
          </div>
          {recons.length === 0 ? (
            <EmptyState
              icon={<IconCheck className="h-5 w-5" />}
              title="Nothing reconciled yet"
              hint="Once transactions are posted you can tie the account back to a statement."
            />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Statement date</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {recons.map((r) => (
                  <tr key={r.id}>
                    <td className="acct">{r.bankNumber}</td>
                    <td>{fmtDate(r.statementDate)}</td>
                    <td className="td-num">{fmtMoney(r.statementBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Import history */}
      <div className="card mt-4 overflow-hidden">
        <div className="border-b border-[var(--ink-100)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">Import history</h2>
        </div>
        {batches.length === 0 ? (
          <EmptyState
            icon={<IconRows className="h-5 w-5" />}
            title="No statements imported yet"
            hint="Upload a CSV export from your bank to get started."
            action={
              <a href={`/accountant/${entityId}/banking/import`} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                Import statement
              </a>
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th>Account</th>
                <th>Imported</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Imported</th>
                <th className="text-right">Duplicates</th>
                <th className="text-right">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium text-[var(--ink-800)]">{b.filename}</td>
                  <td className="acct">{b.bankNumber}</td>
                  <td className="whitespace-nowrap">{fmtDate(b.createdAt)}</td>
                  <td className="td-num">{b.rowCount}</td>
                  <td className="td-num">{b.importedCount}</td>
                  <td className="td-num">{b.duplicateCount}</td>
                  <td className="td-num">{b.rejectedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
