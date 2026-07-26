import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { writeAudit } from "@/services/audit";

/**
 * Employee master data (Phase 5 — Payroll).
 *
 * Statutory deduction/contribution figures are accountant-entered per
 * employee, not computed from a built-in tax table — income tax rates and
 * EOBI contributions change with legislation and are the accountant's call.
 * A pay run copies these onto its lines as editable defaults.
 */

export class EmployeeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeError";
  }
}

export type PayFrequency = "monthly" | "biweekly" | "weekly";

export type EmployeeInput = {
  entityId: string;
  fullName: string;
  email?: string;
  phone?: string;
  hireDate: string;
  payFrequency: PayFrequency;
  basicSalary: string | number;
  allowances?: string | number;
  incomeTaxRate?: string | number;
  eobiEmployeeAmount?: string | number;
  eobiEmployerAmount?: string | number;
  payrollTaxEmployerRate?: string | number;
};

export async function createEmployee(input: EmployeeInput, userId: string) {
  if (!input.fullName.trim()) throw new EmployeeError("Employee name is required");
  if (Number(input.basicSalary) < 0) throw new EmployeeError("Basic salary cannot be negative");

  const numRows = await db.execute(
    sql`SELECT next_document_number(${input.entityId}::uuid, 'employee') AS n`
  );
  const seq = Number((numRows.rows[0] as { n: string | number }).n);
  const employeeNumber = `EMP-${String(seq).padStart(4, "0")}`;

  const [employee] = await db
    .insert(employees)
    .values({
      entityId: input.entityId,
      employeeNumber,
      fullName: input.fullName.trim(),
      email: input.email || undefined,
      phone: input.phone || undefined,
      hireDate: input.hireDate,
      payFrequency: input.payFrequency,
      basicSalary: String(input.basicSalary || 0),
      allowances: String(input.allowances || 0),
      incomeTaxRate: String(input.incomeTaxRate || 0),
      eobiEmployeeAmount: String(input.eobiEmployeeAmount || 0),
      eobiEmployerAmount: String(input.eobiEmployerAmount || 0),
      payrollTaxEmployerRate: String(input.payrollTaxEmployerRate || 0),
      createdBy: userId,
    })
    .returning();

  await writeAudit(db, {
    entityId: input.entityId,
    userId,
    action: "EMPLOYEE_CREATED",
    tableName: "employees",
    recordId: employee.id,
    afterState: { employeeNumber, fullName: employee.fullName },
  });

  return employee;
}

export async function updateEmployee(
  employeeId: string,
  entityId: string,
  input: Omit<EmployeeInput, "entityId">,
  userId: string
) {
  const [existing] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.entityId, entityId)));
  if (!existing) throw new EmployeeError("Employee not found");
  if (!input.fullName.trim()) throw new EmployeeError("Employee name is required");
  if (Number(input.basicSalary) < 0) throw new EmployeeError("Basic salary cannot be negative");

  await db
    .update(employees)
    .set({
      fullName: input.fullName.trim(),
      email: input.email || undefined,
      phone: input.phone || undefined,
      hireDate: input.hireDate,
      payFrequency: input.payFrequency,
      basicSalary: String(input.basicSalary || 0),
      allowances: String(input.allowances || 0),
      incomeTaxRate: String(input.incomeTaxRate || 0),
      eobiEmployeeAmount: String(input.eobiEmployeeAmount || 0),
      eobiEmployerAmount: String(input.eobiEmployerAmount || 0),
      payrollTaxEmployerRate: String(input.payrollTaxEmployerRate || 0),
    })
    .where(eq(employees.id, employeeId));

  await writeAudit(db, {
    entityId,
    userId,
    action: "EMPLOYEE_UPDATED",
    tableName: "employees",
    recordId: employeeId,
    beforeState: { fullName: existing.fullName, basicSalary: existing.basicSalary },
    afterState: { fullName: input.fullName, basicSalary: String(input.basicSalary) },
  });
}

export async function setEmployeeActive(
  employeeId: string,
  entityId: string,
  isActive: boolean,
  userId: string
) {
  const [existing] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.entityId, entityId)));
  if (!existing) throw new EmployeeError("Employee not found");

  await db
    .update(employees)
    .set({
      isActive,
      terminationDate: isActive ? null : new Date().toISOString().slice(0, 10),
    })
    .where(eq(employees.id, employeeId));

  await writeAudit(db, {
    entityId,
    userId,
    action: isActive ? "EMPLOYEE_ACTIVATED" : "EMPLOYEE_DEACTIVATED",
    tableName: "employees",
    recordId: employeeId,
    beforeState: { isActive: existing.isActive },
    afterState: { isActive },
  });
}

export async function listEmployees(entityId: string, opts?: { activeOnly?: boolean }) {
  const rows = await db
    .select()
    .from(employees)
    .where(
      opts?.activeOnly
        ? and(eq(employees.entityId, entityId), eq(employees.isActive, true))
        : eq(employees.entityId, entityId)
    )
    .orderBy(employees.employeeNumber);
  return rows;
}

export async function getEmployee(employeeId: string, entityId: string) {
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.entityId, entityId)));
  return employee ?? null;
}
