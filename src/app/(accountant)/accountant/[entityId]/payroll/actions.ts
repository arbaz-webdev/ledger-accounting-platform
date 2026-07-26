"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import {
  createEmployee,
  updateEmployee,
  setEmployeeActive,
  EmployeeError,
  type PayFrequency,
} from "@/services/employees";
import {
  createPayRunDraft,
  updatePayRunLines,
  postPayRun,
  markPayRunPaid,
  deletePayRunDraft,
  PayrollError,
  type PayRunLineUpdate,
} from "@/services/payroll";
import { MappingError } from "@/services/mappings";
import { JournalValidationError } from "@/services/journal";
import { triggerMessage, dbErrorMessage } from "@/db/errors";

export type FormState = { error?: string };

function readable(err: unknown, fallback: string): string {
  if (
    err instanceof EmployeeError ||
    err instanceof PayrollError ||
    err instanceof MappingError ||
    err instanceof JournalValidationError
  ) {
    return err.message;
  }
  return triggerMessage(err) ?? dbErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

type EmployeePayload = {
  fullName: string;
  email?: string;
  phone?: string;
  hireDate: string;
  payFrequency: PayFrequency;
  basicSalary: string;
  allowances: string;
  incomeTaxRate: string;
  eobiEmployeeAmount: string;
  eobiEmployerAmount: string;
  payrollTaxEmployerRate: string;
};

export async function createEmployeeAction(
  entityId: string,
  payload: EmployeePayload
): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  try {
    await createEmployee({ entityId, ...payload }, user.id);
  } catch (err) {
    return { error: readable(err, "Failed to add employee") };
  }
  revalidatePath(`/accountant/${entityId}/payroll/employees`);
  redirect(`/accountant/${entityId}/payroll/employees`);
}

export async function updateEmployeeAction(
  employeeId: string,
  entityId: string,
  payload: EmployeePayload
): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  try {
    await updateEmployee(employeeId, entityId, payload, user.id);
  } catch (err) {
    return { error: readable(err, "Failed to update employee") };
  }
  revalidatePath(`/accountant/${entityId}/payroll/employees`);
  redirect(`/accountant/${entityId}/payroll/employees`);
}

export async function toggleEmployeeActiveAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const employeeId = String(formData.get("employeeId"));
  const makeActive = String(formData.get("makeActive")) === "true";
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  await setEmployeeActive(employeeId, entityId, makeActive, user.id);
  revalidatePath(`/accountant/${entityId}/payroll/employees`);
}

export type NewPayRunPayload = {
  entityId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  employeeIds: string[];
};

export async function createPayRunAction(payload: NewPayRunPayload): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, payload.entityId);
  await requireModule(user, payload.entityId, "payroll");

  let payRunId: string;
  try {
    const payRun = await createPayRunDraft(payload, user.id);
    payRunId = payRun.id;
  } catch (err) {
    return { error: readable(err, "Failed to create pay run") };
  }
  revalidatePath(`/accountant/${payload.entityId}/payroll`);
  redirect(`/accountant/${payload.entityId}/payroll/${payRunId}`);
}

export async function updatePayRunLinesAction(
  payRunId: string,
  entityId: string,
  lines: PayRunLineUpdate[]
): Promise<FormState> {
  const user = await requireAccountant();
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  try {
    await updatePayRunLines(payRunId, entityId, lines, user.id);
  } catch (err) {
    return { error: readable(err, "Failed to save changes") };
  }
  revalidatePath(`/accountant/${entityId}/payroll/${payRunId}`);
  return {};
}

export async function postPayRunAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const payRunId = String(formData.get("payRunId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  const base = `/accountant/${entityId}/payroll/${payRunId}`;
  try {
    await postPayRun(payRunId, entityId, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to post pay run"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function markPayRunPaidAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const payRunId = String(formData.get("payRunId"));
  const bankAccountId = String(formData.get("bankAccountId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  const base = `/accountant/${entityId}/payroll/${payRunId}`;
  try {
    await markPayRunPaid(payRunId, entityId, bankAccountId, user.id);
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Failed to record payment"))}`);
  }
  revalidatePath(base);
  redirect(base);
}

export async function discardPayRunAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  const payRunId = String(formData.get("payRunId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "payroll");

  try {
    await deletePayRunDraft(payRunId, entityId, user.id);
  } catch (err) {
    redirect(
      `/accountant/${entityId}/payroll/${payRunId}?error=${encodeURIComponent(
        readable(err, "Failed to discard pay run")
      )}`
    );
  }
  revalidatePath(`/accountant/${entityId}/payroll`);
  redirect(`/accountant/${entityId}/payroll`);
}
