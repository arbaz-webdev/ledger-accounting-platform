"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { requireModuleEdit } from "@/services/permissions";
import { createItem, type CostingMethod } from "@/services/inventory";

export async function createBusinessItemAction(formData: FormData) {
  const portal = await portalContext();
  await requireModuleEdit(portal.user, portal.entityId, "inventory");
  const isService = String(formData.get("kind")) === "service";
  const rawMethod = String(formData.get("costingMethod"));
  if (!["fifo", "avco", "specific"].includes(rawMethod)) throw new Error("Invalid costing method");
  const price = String(formData.get("salesPrice") ?? "0");
  if (!/^\d+(\.\d{1,4})?$/.test(price)) redirect("/business/catalog?error=Enter%20a%20valid%20sales%20price");
  try {
    await createItem({
      entityId: portal.entityId,
      sku: String(formData.get("sku") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      costingMethod: rawMethod as CostingMethod,
      unit: String(formData.get("unit") ?? "unit"),
      salesPrice: price,
      isService,
      reorderLevel: String(formData.get("reorderLevel") ?? "0"),
    }, portal.user.id);
  } catch (error) {
    redirect(`/business/catalog?error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to add item")}`);
  }
  revalidatePath("/business/catalog");
  redirect("/business/catalog");
}
