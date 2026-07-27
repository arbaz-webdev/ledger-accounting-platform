import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { requireFirmOwner } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { FirmSettingsForm } from "./settings-form";

export default async function FirmSettingsPage() {
  const user = await requireFirmOwner();
  const [firm] = await db.select().from(firms).where(eq(firms.id, user.firmId));

  return (
    <div className="fade-up">
      <PageHeader
        title="Firm settings"
        sub="How your practice appears in the platform. Client-level settings live in each client's books."
      />
      <FirmSettingsForm
        initial={{
          name: firm?.name ?? "",
          legalName: firm?.legalName ?? "",
          contactEmail: firm?.contactEmail ?? "",
          contactPhone: firm?.contactPhone ?? "",
        }}
      />
    </div>
  );
}
