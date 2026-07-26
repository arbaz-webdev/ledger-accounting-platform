import { getApAgeing } from "@/services/ageing";
import { todayIso } from "@/lib/format";
import { AgeingReportView } from "@/components/ageing-report";

export default async function ApAgeingPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { entityId } = await params;
  const sp = await searchParams;
  const asOf = sp.asOf && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : todayIso();

  const report = await getApAgeing(entityId, asOf);

  return (
    <AgeingReportView
      title="AP Ageing"
      sub="Open supplier bills grouped by how far past due they are — use it to plan cash."
      report={report}
      entityId={entityId}
      contactLabel="Supplier"
      documentHref={(id) => `/accountant/${entityId}/purchases/${id}`}
    />
  );
}
