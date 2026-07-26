import { listBankAccounts } from "@/services/bank-import";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBank } from "@/components/icons";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const accounts = await listBankAccounts(entityId);

  return (
    <div className="fade-up">
      <PageHeader
        title="Import bank statement"
        sub="Upload a CSV export. Rows are validated, de-duplicated and auto-categorised before you review them."
      >
        <a href={`/accountant/${entityId}/banking`} className="btn btn-secondary">
          Back to banking
        </a>
      </PageHeader>

      {accounts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconBank className="h-5 w-5" />}
            title="No bank accounts available"
            hint="Add an asset account numbered 1000–1099 (or with the cash & bank sub-type) in the Chart of Accounts first."
            action={
              <a href={`/accountant/${entityId}/coa`} className="btn btn-primary btn-sm">
                Go to Chart of Accounts
              </a>
            }
          />
        </div>
      ) : (
        <ImportWizard entityId={entityId} bankAccounts={accounts} />
      )}
    </div>
  );
}
