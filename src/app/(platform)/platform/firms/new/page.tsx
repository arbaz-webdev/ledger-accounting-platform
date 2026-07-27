import { listPlans } from "@/services/plans";
import { fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { NewFirmForm } from "./new-firm-form";

export default async function NewFirmPage() {
  const plans = await listPlans({ activeOnly: true });

  return (
    <div className="fade-up">
      <PageHeader
        title="New firm"
        sub="Creates the firm, its owner login and its subscription in one transaction — all three or none."
      />
      <NewFirmForm
        plans={plans.map((p) => ({
          id: p.id,
          label: `${p.name} — ${fmtMoney(p.monthlyPrice)}/mo · ${
            p.maxEntities ?? "unlimited"
          } clients, ${p.maxUsers ?? "unlimited"} users`,
        }))}
      />
    </div>
  );
}
