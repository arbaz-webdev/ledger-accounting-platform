"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import { setPeriodLock, ensureYearPeriods } from "@/services/periods";
import { closeFiscalYear, reopenFiscalYear, YearEndError } from "@/services/year-end";
import { MappingError } from "@/services/mappings";
import { JournalValidationError } from "@/services/journal";
import { triggerMessage, dbErrorMessage } from "@/db/errors";

function readable(err: unknown, fallback: string): string {
  if (
    err instanceof YearEndError ||
    err instanceof MappingError ||
    err instanceof JournalValidationError
  ) {
    return err.message;
  }
  return triggerMessage(err) ?? dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

export async function togglePeriodLockAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  const lock = String(formData.get("lock")) === "true";
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "periods");

  // Spec 15: period lock/unlock is a firm_admin permission, not staff
  if (user.role === "accountant_staff") {
    throw new Error("Only firm admins can lock or unlock periods");
  }

  await setPeriodLock(entityId, year, month, lock, user.id);
  revalidatePath(`/accountant/${entityId}/periods`);
}

export async function setupYearAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const year = Number(formData.get("year"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "periods");

  await ensureYearPeriods(entityId, year);
  revalidatePath(`/accountant/${entityId}/periods`);
}

/** Lock after the close-review checklist. Advisory: warnings never block. */
export async function confirmLockAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "periods");

  if (user.role === "accountant_staff") {
    throw new Error("Only firm admins can lock or unlock periods");
  }

  await setPeriodLock(entityId, year, month, true, user.id);
  revalidatePath(`/accountant/${entityId}/periods`);
  redirect(`/accountant/${entityId}/periods?year=${year}`);
}

export async function closeYearAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const startYear = Number(formData.get("startYear"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "periods");

  if (user.role === "accountant_staff") {
    throw new Error("Only firm admins can close a fiscal year");
  }

  const base = `/accountant/${entityId}/periods/year-end?year=${startYear}`;
  try {
    await closeFiscalYear(entityId, startYear, user.id);
  } catch (err) {
    redirect(`${base}&error=${encodeURIComponent(readable(err, "Failed to close the year"))}`);
  }
  revalidatePath(`/accountant/${entityId}/periods`);
  redirect(base);
}

export async function reopenYearAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const closeId = String(formData.get("closeId"));
  const startYear = Number(formData.get("startYear"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "periods");

  if (user.role === "accountant_staff") {
    throw new Error("Only firm admins can reopen a fiscal year");
  }

  const base = `/accountant/${entityId}/periods/year-end?year=${startYear}`;
  try {
    await reopenFiscalYear(entityId, closeId, user.id);
  } catch (err) {
    redirect(`${base}&error=${encodeURIComponent(readable(err, "Failed to reopen the year"))}`);
  }
  revalidatePath(`/accountant/${entityId}/periods`);
  redirect(base);
}
