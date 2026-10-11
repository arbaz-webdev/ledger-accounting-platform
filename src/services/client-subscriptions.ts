import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientSubscriptionManagement, entities } from "@/db/schema";
import { writeAudit } from "@/services/audit";

export class ClientSubscriptionError extends Error {}

export async function getClientSubscriptionManagement(firmId: string, entityId: string) {
  const [entity] = await db.select({ id: entities.id, name: entities.name, baseCurrency: entities.baseCurrency })
    .from(entities).where(and(eq(entities.id, entityId), eq(entities.firmId, firmId), eq(entities.isFirmBooks, false)));
  if (!entity) throw new ClientSubscriptionError("Client not found in this firm");
  const [saved] = await db.select().from(clientSubscriptionManagement).where(eq(clientSubscriptionManagement.entityId, entityId));
  return { entity, managedBy: saved?.managedBy ?? "client", monthlyFee: saved?.monthlyFee ?? "0.00",
    currency: saved?.currency ?? entity.baseCurrency, renewalOn: saved?.renewalOn ?? "", notes: saved?.notes ?? "" };
}

export async function updateClientSubscriptionManagement(firmId: string, entityId: string, actingUserId: string, input: {
  managedBy: "firm" | "client"; monthlyFee: string; currency: string; renewalOn?: string; notes?: string;
}) {
  if (!["firm","client"].includes(input.managedBy)) throw new ClientSubscriptionError("Invalid management choice");
  const fee = input.monthlyFee.trim() || "0";
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(fee)) throw new ClientSubscriptionError("Monthly fee must be a positive amount with at most two decimals");
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ClientSubscriptionError("Currency must be a three-letter code");
  if (input.renewalOn && (!/^\d{4}-\d{2}-\d{2}$/.test(input.renewalOn) || Number.isNaN(Date.parse(input.renewalOn)))) throw new ClientSubscriptionError("Renewal date is invalid");
  return db.transaction(async tx => {
    const [entity] = await tx.select({ id: entities.id }).from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.firmId, firmId), eq(entities.isFirmBooks, false))).for("update");
    if (!entity) throw new ClientSubscriptionError("Client not found in this firm");
    const [before] = await tx.select().from(clientSubscriptionManagement).where(eq(clientSubscriptionManagement.entityId, entityId));
    const next = { managedBy: input.managedBy, monthlyFee: fee, currency, renewalOn: input.renewalOn || null,
      notes: input.notes?.trim().slice(0, 2000) || null, updatedAt: new Date() };
    await tx.insert(clientSubscriptionManagement).values({ entityId, ...next })
      .onConflictDoUpdate({ target: clientSubscriptionManagement.entityId, set: next });
    await writeAudit(tx, { entityId, userId: actingUserId, action: "CLIENT_SUBSCRIPTION_MANAGEMENT_UPDATED",
      tableName: "client_subscription_management", recordId: entityId,
      beforeState: before ?? null, afterState: next });
  });
}
