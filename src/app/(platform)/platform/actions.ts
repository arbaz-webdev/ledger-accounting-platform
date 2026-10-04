"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { provisionFirm, setFirmActive, FirmError } from "@/services/firms";
import {
  setFirmSubscription,
  SubscriptionError,
  type SubscriptionStatus,
} from "@/services/subscriptions";
import { createPlan, updatePlan, setPlanActive, PlanError } from "@/services/plans";
import { isUniqueViolation, dbErrorMessage } from "@/db/errors";

export type FormState = { error?: string; ok?: string };

function readable(err: unknown, fallback: string): string {
  if (err instanceof FirmError || err instanceof SubscriptionError || err instanceof PlanError) {
    return err.message;
  }
  if (isUniqueViolation(err)) {
    return "That email or code is already taken";
  }
  return dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

// ---------------------------------------------------------------------------
// Firms
// ---------------------------------------------------------------------------

export async function provisionFirmAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requirePlatformAdmin();

  let firmId: string;
  try {
    const result = await provisionFirm(
      {
        name: String(formData.get("name") ?? ""),
        legalName: String(formData.get("legalName") ?? "") || undefined,
        contactEmail: String(formData.get("contactEmail") ?? "") || undefined,
        contactPhone: String(formData.get("contactPhone") ?? "") || undefined,
        ownerFullName: String(formData.get("ownerFullName") ?? ""),
        ownerEmail: String(formData.get("ownerEmail") ?? ""),
        ownerPassword: String(formData.get("ownerPassword") ?? ""),
        planId: String(formData.get("planId") ?? ""),
        status: String(formData.get("status")) === "active" ? "active" : "trial",
        trialDays: Number(formData.get("trialDays")) || 14,
      },
      user.id
    );
    firmId = result.firmId;
  } catch (err) {
    return { error: readable(err, "Failed to create the firm") };
  }
  revalidatePath("/platform/firms");
  redirect(`/platform/firms/${firmId}`);
}

export async function setFirmActiveAction(formData: FormData): Promise<void> {
  const user = await requirePlatformAdmin();
  const firmId = String(formData.get("firmId"));
  const makeActive = String(formData.get("makeActive")) === "true";

  const base = `/platform/firms/${firmId}`;
  try {
    await setFirmActive(firmId, makeActive, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to update the firm"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function setSubscriptionAction(formData: FormData): Promise<void> {
  const user = await requirePlatformAdmin();
  const firmId = String(formData.get("firmId"));

  const base = `/platform/firms/${firmId}`;
  try {
    await setFirmSubscription(
      {
        firmId,
        planId: String(formData.get("planId") ?? ""),
        status: String(formData.get("status") ?? "trial") as SubscriptionStatus,
        trialEndsOn: String(formData.get("trialEndsOn") ?? "") || null,
        currentPeriodEnd: String(formData.get("currentPeriodEnd") ?? "") || null,
        notes: String(formData.get("notes") ?? "") || null,
      },
      user.id
    );
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to update subscription"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function createPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePlatformAdmin();
  try {
    await createPlan(
      {
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || undefined,
        monthlyPrice: String(formData.get("monthlyPrice") ?? "0"),
        currency: String(formData.get("currency") ?? "USD"),
        maxEntities: String(formData.get("maxEntities") ?? ""),
        maxUsers: String(formData.get("maxUsers") ?? ""),
        sortOrder: String(formData.get("sortOrder") ?? "100"),
      },
      user.id
    );
  } catch (err) {
    return { error: readable(err, "Failed to create the plan") };
  }
  revalidatePath("/platform/plans");
  return { ok: "Plan created." };
}

export async function updatePlanAction(formData: FormData): Promise<void> {
  const user = await requirePlatformAdmin();
  const planId = String(formData.get("planId"));
  try {
    await updatePlan(
      planId,
      {
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || undefined,
        monthlyPrice: String(formData.get("monthlyPrice") ?? "0"),
        currency: String(formData.get("currency") ?? "USD"),
        maxEntities: String(formData.get("maxEntities") ?? ""),
        maxUsers: String(formData.get("maxUsers") ?? ""),
        sortOrder: String(formData.get("sortOrder") ?? "100"),
      },
      user.id
    );
  } catch (err) {
    redirect(`/platform/plans?error=${encodeURIComponent(readable(err, "Failed to save the plan"))}`);
  }
  revalidatePath("/platform/plans");
  redirect("/platform/plans");
}

export async function setPlanActiveAction(formData: FormData): Promise<void> {
  const user = await requirePlatformAdmin();
  const planId = String(formData.get("planId"));
  const makeActive = String(formData.get("makeActive")) === "true";
  try {
    await setPlanActive(planId, makeActive, user.id);
  } catch (err) {
    redirect(`/platform/plans?error=${encodeURIComponent(readable(err, "Failed to update the plan"))}`);
  }
  revalidatePath("/platform/plans");
  redirect("/platform/plans");
}
