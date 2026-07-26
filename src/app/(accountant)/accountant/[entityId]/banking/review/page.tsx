import { listBankTransactions } from "@/services/bank-import";
import { listAccounts } from "@/services/coa";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconCheck, IconPlus } from "@/components/icons";
import { ReviewQueue } from "./review-queue";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ error?: string; posted?: string }>;
}) {
  const { entityId } = await params;
  const { error, posted } = await searchParams;

  const [transactions, accounts] = await Promise.all([
    listBankTransactions(entityId, { status: "open" }),
    listAccounts(entityId),
  ]);

  // Bank/cash accounts are the other side of these entries, so exclude them
  const categoryAccounts = accounts
    .filter((a) => a.isActive && a.subType !== "cash_and_bank")
    .map((a) => ({ id: a.id, label: `${a.accountNumber} — ${a.name}` }));

  const uncategorised = transactions.filter((t) => !t.categoryAccountId).length;

  return (
    <div className="fade-up">
      <PageHeader
        title="Review queue"
        sub={`${transactions.length} imported transaction(s) awaiting review · ${uncategorised} uncategorised`}
      >
        <a href={`/accountant/${entityId}/banking/import`} className="btn btn-secondary">
          <IconPlus className="h-4 w-4" />
          Import more
        </a>
      </PageHeader>

      {posted && (
        <div className="banner banner-ok mb-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{posted}</span>
        </div>
      )}
      {error && (
        <div className="banner banner-error mb-4" role="alert">
          {error}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconCheck className="h-5 w-5" />}
            title="Nothing to review"
            hint="Every imported transaction has been posted or ignored. Import another statement when you're ready."
            action={
              <a href={`/accountant/${entityId}/banking/import`} className="btn btn-primary btn-sm">
                Import statement
              </a>
            }
          />
        </div>
      ) : (
        <ReviewQueue
          entityId={entityId}
          transactions={transactions}
          accounts={categoryAccounts}
        />
      )}
    </div>
  );
}
