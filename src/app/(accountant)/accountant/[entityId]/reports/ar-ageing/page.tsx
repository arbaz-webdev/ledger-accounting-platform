import { getArAgeing } from "@/services/ageing";
import { todayIso } from "@/lib/format";
import { AgeingReportView } from "@/components/ageing-report";

export default async function ArAgeingPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const asOf = sp.asOf && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : todayIso();

  const report = await getArAgeing(entityId, asOf);

  return (
    <AgeingReportView
      title="AR Ageing"
      sub="Open customer invoices grouped by how far past due they are."
      report={report}
      entityId={entityId}
      contactLabel="Customer"
      documentHref={(id) => `/accountant/${entityId}/sales/${id}`}
    />
  );
}
