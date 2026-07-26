import { listAccounts } from "@/services/coa";
import { JournalEntryForm } from "./je-form";
import { PageHeader } from "@/components/ui";

export default async function NewJournalEntryPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const accounts = (await listAccounts(entityId)).filter((a) => a.isActive);

  return (
    <div className="fade-up">
      <PageHeader
        title="New journal entry"
        sub="Debits must equal credits. Posted entries are immutable — voiding creates a reversal."
      />
      <JournalEntryForm
        entityId={entityId}
        accounts={accounts.map((a) => ({
          id: a.id,
          label: `${a.accountNumber} — ${a.name}`,
        }))}
      />
    </div>
  );
}
