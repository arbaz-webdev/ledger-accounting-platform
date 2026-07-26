"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import {
  createItem,
  updateItem,
  setItemActive,
  recordManualMovement,
  InventoryError,
  type CostingMethod,
  type LotPick,
} from "@/services/inventory";
import { MappingError } from "@/services/mappings";
import { JournalValidationError } from "@/services/journal";
import { isUniqueViolation, triggerMessage, dbErrorMessage } from "@/db/errors";

export type FormState = { error?: string };

function readable(err: unknown, fallback: string): string {
  if (
    err instanceof InventoryError ||
    err instanceof MappingError ||
    err instanceof JournalValidationError
  ) {
    return err.message;
  }
  if (isUniqueViolation(err)) return "That SKU already exists for this client";
  return triggerMessage(err) ?? dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

export type ItemPayload = {
  sku: string;
  name: string;
  description?: string;
  costingMethod: CostingMethod;
  unit?: string;
  salesPrice?: string;
};

export async function createItemAction(
  entityId: string,
  payload: ItemPayload
): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "inventory");

  let itemId: string;
  try {
    const item = await createItem({ entityId, ...payload }, user.id);
    itemId = item.id;
  } catch (err) {
    return { error: readable(err, "Failed to create item") };
  }
  revalidatePath(`/accountant/${entityId}/inventory`);
  redirect(`/accountant/${entityId}/inventory/${itemId}`);
}

export async function updateItemAction(
  itemId: string,
  entityId: string,
  payload: Omit<ItemPayload, "costingMethod">
): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "inventory");

  try {
    await updateItem(itemId, entityId, payload, user.id);
  } catch (err) {
    return { error: readable(err, "Failed to update item") };
  }
  revalidatePath(`/accountant/${entityId}/inventory/${itemId}`);
  return {};
}

export async function toggleItemActiveAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const itemId = String(formData.get("itemId"));
  const makeActive = String(formData.get("makeActive")) === "true";
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "inventory");

  await setItemActive(itemId, entityId, makeActive, user.id);
  revalidatePath(`/accountant/${entityId}/inventory`);
  revalidatePath(`/accountant/${entityId}/inventory/${itemId}`);
}

export type MovementPayload = {
  itemId: string;
  kind: "receipt" | "issue" | "adjust_in" | "adjust_out" | "write_down";
  date: string;
  quantity: string;
  unitCost?: string;
  lotRef?: string;
  counterAccountId?: string;
  picks?: LotPick[];
  reference?: string;
  notes?: string;
};

export async function recordMovementAction(
  entityId: string,
  payload: MovementPayload
): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "inventory");

  try {
    await recordManualMovement({ entityId, ...payload }, user.id);
  } catch (err) {
    return { error: readable(err, "Failed to record movement") };
  }
  revalidatePath(`/accountant/${entityId}/inventory/${payload.itemId}`);
  revalidatePath(`/accountant/${entityId}/inventory`);
  return {};
}
