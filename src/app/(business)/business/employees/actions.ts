"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { requireModuleEdit } from "@/services/permissions";
import { createEmployee, type PayFrequency } from "@/services/employees";

export async function createBusinessEmployeeAction(form: FormData) {
  const ctx = await portalContext();
  if (ctx.user.role !== "business_admin") throw new Error("Business owner access required");
  await requireModuleEdit(ctx.user,ctx.entityId,"payroll");
  try {
    await createEmployee({entityId:ctx.entityId, fullName:String(form.get("fullName") ?? ""),
      email:String(form.get("email") ?? ""), phone:String(form.get("phone") ?? ""),
      hireDate:String(form.get("hireDate")), payFrequency:String(form.get("payFrequency")) as PayFrequency,
      basicSalary:String(form.get("basicSalary") ?? "0"), allowances:String(form.get("allowances") ?? "0"),
      incomeTaxRate:String(form.get("incomeTaxRate") ?? "0"),
      eobiEmployeeAmount:String(form.get("eobiEmployeeAmount") ?? "0"),
      eobiEmployerAmount:String(form.get("eobiEmployerAmount") ?? "0"),
      payrollTaxEmployerRate:String(form.get("payrollTaxEmployerRate") ?? "0")},ctx.user.id);
  } catch (error) { redirect(`/business/employees?error=${encodeURIComponent(error instanceof Error ? error.message : "Could not add employee")}`); }
  revalidatePath("/business/employees");
  redirect("/business/employees?saved=1");
}
