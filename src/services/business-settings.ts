import "server-only";
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSettings, entities } from "@/db/schema";
import { writeAudit } from "@/services/audit";

export async function getBusinessSettings(entityId: string) {
  const [entity] = await db.select({ name: entities.name, legalName: entities.legalName, baseCurrency: entities.baseCurrency,
    fiscalYearStartMonth: entities.fiscalYearStartMonth }).from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error("Business not found");
  const [saved] = await db.select().from(businessSettings).where(eq(businessSettings.entityId, entityId));
  return { ...entity,
    legalStructure: saved?.legalStructure ?? "",
    taxIdentifiers: saved?.taxIdentifiers ?? "",
    registeredAddress: saved?.registeredAddress ?? "",
    brandAccent: saved?.brandAccent ?? "#0d9488",
    invoiceHeader: saved?.invoiceHeader ?? "",
    invoicePrefix: saved?.invoicePrefix ?? "INV",
    billPrefix: saved?.billPrefix ?? "BILL",
    invoiceTerms: saved?.invoiceTerms ?? "",
    defaultTaxRate: saved?.defaultTaxRate ?? "0",
    invoiceEmailTemplate: saved?.invoiceEmailTemplate ?? "",
    reminderEmailTemplate: saved?.reminderEmailTemplate ?? "",
  };
}

export type BusinessSettingsInput = {
  name: string; legalName: string; fiscalYearStartMonth: number;
  legalStructure: string; taxIdentifiers: string; registeredAddress: string;
  brandAccent: string; invoiceHeader: string; invoicePrefix: string; billPrefix: string;
  invoiceTerms: string; defaultTaxRate: string; invoiceEmailTemplate: string; reminderEmailTemplate: string;
};

export async function updateBusinessSettings(entityId: string, userId: string, input: BusinessSettingsInput) {
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new Error("Business name is required");
  if (!Number.isInteger(input.fiscalYearStartMonth) || input.fiscalYearStartMonth < 1 || input.fiscalYearStartMonth > 12) throw new Error("Invalid fiscal start month");
  if (!/^#[0-9a-fA-F]{6}$/.test(input.brandAccent)) throw new Error("Brand color must be a six-digit hex color");
  for (const prefix of [input.invoicePrefix, input.billPrefix]) {
    if (!/^[A-Z0-9-]{2,12}$/.test(prefix)) throw new Error("Number prefixes must be 2–12 uppercase letters, numbers or hyphens");
  }
  const tax = new Decimal(input.defaultTaxRate || 0);
  if (!tax.isFinite() || tax.isNegative() || tax.greaterThan(100) || tax.decimalPlaces() > 4) throw new Error("Default tax rate must be between 0 and 100");
  return db.transaction(async (tx) => {
    const [entity] = await tx.select().from(entities).where(eq(entities.id, entityId)).for("update");
    if (!entity) throw new Error("Business not found");
    if (entity.fiscalYearStartMonth !== input.fiscalYearStartMonth) {
      const activity = await tx.execute(sql`SELECT 1 FROM journal_entries WHERE entity_id=${entityId} AND status IN ('posted','voided') LIMIT 1`);
      if (activity.rows.length) throw new Error("Fiscal start month cannot change after transactions are posted");
    }
    const [before] = await tx.select().from(businessSettings).where(eq(businessSettings.entityId, entityId));
    const settings = {
      legalStructure: input.legalStructure.trim().slice(0, 120), taxIdentifiers: input.taxIdentifiers.trim().slice(0, 500),
      registeredAddress: input.registeredAddress.trim().slice(0, 1000), brandAccent: input.brandAccent.toLowerCase(),
      invoiceHeader: input.invoiceHeader.trim().slice(0, 250), invoicePrefix: input.invoicePrefix,
      billPrefix: input.billPrefix, invoiceTerms: input.invoiceTerms.trim().slice(0, 2000),
      defaultTaxRate: tax.toString(), invoiceEmailTemplate: input.invoiceEmailTemplate.trim().slice(0, 4000),
      reminderEmailTemplate: input.reminderEmailTemplate.trim().slice(0, 4000), updatedAt: new Date(),
    };
    await tx.update(entities).set({ name, legalName: input.legalName.trim().slice(0, 200),
      fiscalYearStartMonth: input.fiscalYearStartMonth }).where(eq(entities.id, entityId));
    await tx.insert(businessSettings).values({ entityId, ...settings }).onConflictDoUpdate({ target: businessSettings.entityId, set: settings });
    await writeAudit(tx, { entityId, userId, action: "BUSINESS_SETTINGS_UPDATED", tableName: "business_settings", recordId: entityId,
      beforeState: { name: entity.name, legalName: entity.legalName, fiscalYearStartMonth: entity.fiscalYearStartMonth, settings: before },
      afterState: { name, legalName: input.legalName, fiscalYearStartMonth: input.fiscalYearStartMonth, settings } });
  });
}
