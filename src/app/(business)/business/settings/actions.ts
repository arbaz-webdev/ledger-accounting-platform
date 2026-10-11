"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { updateBusinessSettings } from "@/services/business-settings";

export async function saveBusinessSettingsAction(formData: FormData) {
  const ctx = await portalContext();
  if (ctx.user.role !== "business_admin") redirect("/business?denied=settings");
  const value = (key: string) => String(formData.get(key) ?? "");
  try {
    await updateBusinessSettings(ctx.entityId, ctx.user.id, {
      name: value("name"), legalName: value("legalName"),
      fiscalYearStartMonth: Number(value("fiscalYearStartMonth")),
      legalStructure: value("legalStructure"), taxIdentifiers: value("taxIdentifiers"),
      registeredAddress: value("registeredAddress"), brandAccent: value("brandAccent"),
      invoiceHeader: value("invoiceHeader"), invoicePrefix: value("invoicePrefix").toUpperCase().trim(),
      billPrefix: value("billPrefix").toUpperCase().trim(), invoiceTerms: value("invoiceTerms"),
      defaultTaxRate: value("defaultTaxRate"), invoiceEmailTemplate: value("invoiceEmailTemplate"),
      reminderEmailTemplate: value("reminderEmailTemplate"),
    });
  } catch (error) {
    redirect(`/business/settings?error=${encodeURIComponent(error instanceof Error ? error.message : "Could not save settings")}`);
  }
  revalidatePath("/business", "layout");
  redirect("/business/settings?saved=1");
}
