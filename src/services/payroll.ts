import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, payRuns, payRunLines, chartOfAccounts } from "@/db/schema";
import { postJournalEntry, type JournalEntryInput } from "@/services/journal";
import { resolveMapping, getMappings } from "@/services/mappings";
import { writeAudit } from "@/services/audit";

/**
 * Payroll (spec-adjacent, Phase 5): employees, pay runs, payslip lines.
 *
 * A pay run posts ONE journal entry through postJournalEntry — nothing here
 * writes to journal_entry_lines directly:
 *   DR Salaries & Wages Expense    SUM(gross pay)
 *   DR Payroll Tax Expense         SUM(employer EOBI + employer payroll tax)
 *   CR Income Tax Payable          SUM(income tax withheld)
 *   CR Pension / EOBI Payable      SUM(employee + employer EOBI)
 *   CR Payroll Tax Payable         SUM(employer payroll tax)
 *   CR Salaries Payable            SUM(net pay)
 *
 * Paying employees is a second JE (Salaries Payable -> Bank) — payday
 * routinely trails period end, mirroring how bill/invoice settlements work.
 */

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollError";
  }
}

function computeLine(emp: {
  basicSalary: string;
  allowances: string;
  incomeTaxRate: string;
  eobiEmployeeAmount: string;
  eobiEmployerAmount: string;
  payrollTaxEmployerRate: string;
}) {
  const basic = new Decimal(emp.basicSalary);
  const allowances = new Decimal(emp.allowances);
  const gross = basic.plus(allowances);
  const incomeTax = gross.times(emp.incomeTaxRate).dividedBy(100).toDecimalPlaces(2);
  const eobiEmployee = new Decimal(emp.eobiEmployeeAmount).toDecimalPlaces(2);
  const eobiEmployer = new Decimal(emp.eobiEmployerAmount).toDecimalPlaces(2);
  const payrollTaxEmployer = gross
    .times(emp.payrollTaxEmployerRate)
    .dividedBy(100)
    .toDecimalPlaces(2);
  const net = gross.minus(incomeTax).minus(eobiEmployee);
  return { basic, allowances, gross, incomeTax, eobiEmployee, eobiEmployer, payrollTaxEmployer, net };
}

export type CreatePayRunInput = {
  entityId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  employeeIds: string[];
};

export async function createPayRunDraft(input: CreatePayRunInput, userId: string) {
  if (input.employeeIds.length === 0) {
    throw new PayrollError("Select at least one employee for this pay run");
  }
  if (input.periodEnd < input.periodStart) {
    throw new PayrollError("Period end must be on or after period start");
  }

  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.entityId, input.entityId), inArray(employees.id, input.employeeIds)));
  if (emps.length === 0) throw new PayrollError("No matching employees found");

  const numRows = await db.execute(
    sql`SELECT next_document_number(${input.entityId}::uuid, 'pay_run') AS n`
  );
  const seq = Number((numRows.rows[0] as { n: string | number }).n);
  const runNumber = `PR-${String(seq).padStart(4, "0")}`;

  const computed = emps.map((e) => ({ employeeId: e.id, ...computeLine(e) }));
  const totals = computed.reduce(
    (s, c) => ({
      gross: s.gross.plus(c.gross),
      incomeTax: s.incomeTax.plus(c.incomeTax),
      eobiEmployee: s.eobiEmployee.plus(c.eobiEmployee),
      eobiEmployer: s.eobiEmployer.plus(c.eobiEmployer),
      payrollTaxEmployer: s.payrollTaxEmployer.plus(c.payrollTaxEmployer),
      net: s.net.plus(c.net),
    }),
    {
      gross: new Decimal(0),
      incomeTax: new Decimal(0),
      eobiEmployee: new Decimal(0),
      eobiEmployer: new Decimal(0),
      payrollTaxEmployer: new Decimal(0),
      net: new Decimal(0),
    }
  );

  const [payRun] = await db
    .insert(payRuns)
    .values({
      entityId: input.entityId,
      runNumber,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate,
      grossTotal: totals.gross.toFixed(2),
      incomeTaxTotal: totals.incomeTax.toFixed(2),
      eobiEmployeeTotal: totals.eobiEmployee.toFixed(2),
      eobiEmployerTotal: totals.eobiEmployer.toFixed(2),
      payrollTaxEmployerTotal: totals.payrollTaxEmployer.toFixed(2),
      netTotal: totals.net.toFixed(2),
      createdBy: userId,
    })
    .returning();

  await db.insert(payRunLines).values(
    computed.map((c) => ({
      payRunId: payRun.id,
      employeeId: c.employeeId,
      basicSalary: c.basic.toFixed(2),
      allowances: c.allowances.toFixed(2),
      grossPay: c.gross.toFixed(2),
      incomeTaxAmount: c.incomeTax.toFixed(2),
      eobiEmployeeAmount: c.eobiEmployee.toFixed(2),
      eobiEmployerAmount: c.eobiEmployer.toFixed(2),
      payrollTaxEmployerAmount: c.payrollTaxEmployer.toFixed(2),
      netPay: c.net.toFixed(2),
    }))
  );

  await writeAudit(db, {
    entityId: input.entityId,
    userId,
    action: "PAY_RUN_CREATED",
    tableName: "pay_runs",
    recordId: payRun.id,
    afterState: { runNumber, employees: emps.length, netTotal: totals.net.toFixed(2) },
  });

  return payRun;
}

export type PayRunLineUpdate = {
  employeeId: string;
  basicSalary: string | number;
  allowances: string | number;
  incomeTaxAmount: string | number;
  eobiEmployeeAmount: string | number;
  eobiEmployerAmount: string | number;
  payrollTaxEmployerAmount: string | number;
};

export async function updatePayRunLines(
  payRunId: string,
  entityId: string,
  lines: PayRunLineUpdate[],
  userId: string
) {
  const [payRun] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, payRunId), eq(payRuns.entityId, entityId)));
  if (!payRun) throw new PayrollError("Pay run not found");
  if (payRun.status !== "draft") throw new PayrollError("Only draft pay runs can be edited");

  const totals = {
    gross: new Decimal(0),
    incomeTax: new Decimal(0),
    eobiEmployee: new Decimal(0),
    eobiEmployer: new Decimal(0),
    payrollTaxEmployer: new Decimal(0),
    net: new Decimal(0),
  };

  for (const line of lines) {
    const basic = new Decimal(line.basicSalary || 0);
    const allowances = new Decimal(line.allowances || 0);
    const gross = basic.plus(allowances);
    const incomeTax = new Decimal(line.incomeTaxAmount || 0).toDecimalPlaces(2);
    const eobiEmployee = new Decimal(line.eobiEmployeeAmount || 0).toDecimalPlaces(2);
    const eobiEmployer = new Decimal(line.eobiEmployerAmount || 0).toDecimalPlaces(2);
    const payrollTaxEmployer = new Decimal(line.payrollTaxEmployerAmount || 0).toDecimalPlaces(2);
    const net = gross.minus(incomeTax).minus(eobiEmployee);
    if (net.isNegative()) {
      throw new PayrollError("Deductions cannot exceed gross pay for one or more employees");
    }

    await db
      .update(payRunLines)
      .set({
        basicSalary: basic.toFixed(2),
        allowances: allowances.toFixed(2),
        grossPay: gross.toFixed(2),
        incomeTaxAmount: incomeTax.toFixed(2),
        eobiEmployeeAmount: eobiEmployee.toFixed(2),
        eobiEmployerAmount: eobiEmployer.toFixed(2),
        payrollTaxEmployerAmount: payrollTaxEmployer.toFixed(2),
        netPay: net.toFixed(2),
      })
      .where(and(eq(payRunLines.payRunId, payRunId), eq(payRunLines.employeeId, line.employeeId)));

    totals.gross = totals.gross.plus(gross);
    totals.incomeTax = totals.incomeTax.plus(incomeTax);
    totals.eobiEmployee = totals.eobiEmployee.plus(eobiEmployee);
    totals.eobiEmployer = totals.eobiEmployer.plus(eobiEmployer);
    totals.payrollTaxEmployer = totals.payrollTaxEmployer.plus(payrollTaxEmployer);
    totals.net = totals.net.plus(net);
  }

  await db
    .update(payRuns)
    .set({
      grossTotal: totals.gross.toFixed(2),
      incomeTaxTotal: totals.incomeTax.toFixed(2),
      eobiEmployeeTotal: totals.eobiEmployee.toFixed(2),
      eobiEmployerTotal: totals.eobiEmployer.toFixed(2),
      payrollTaxEmployerTotal: totals.payrollTaxEmployer.toFixed(2),
      netTotal: totals.net.toFixed(2),
    })
    .where(eq(payRuns.id, payRunId));

  await writeAudit(db, {
    entityId,
    userId,
    action: "PAY_RUN_LINES_UPDATED",
    tableName: "pay_runs",
    recordId: payRunId,
    afterState: { netTotal: totals.net.toFixed(2) },
  });
}

export async function postPayRun(payRunId: string, entityId: string, userId: string) {
  const [payRun] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, payRunId), eq(payRuns.entityId, entityId)));
  if (!payRun) throw new PayrollError("Pay run not found");
  if (payRun.status !== "draft") {
    throw new PayrollError(`Only draft pay runs can be posted (this one is ${payRun.status})`);
  }

  const lines = await db.select().from(payRunLines).where(eq(payRunLines.payRunId, payRunId));
  if (lines.length === 0) throw new PayrollError("Pay run has no employees");

  const cache = await getMappings(entityId);
  const salariesExpense = await resolveMapping(entityId, "salaries_expense", cache);
  const payrollTaxExpense = await resolveMapping(entityId, "payroll_tax_expense", cache);
  const incomeTaxPayable = await resolveMapping(entityId, "income_tax_payable", cache);
  const eobiPayable = await resolveMapping(entityId, "eobi_payable", cache);
  const payrollTaxPayable = await resolveMapping(entityId, "payroll_tax_payable", cache);
  const salariesPayable = await resolveMapping(entityId, "salaries_payable", cache);

  const gross = new Decimal(payRun.grossTotal);
  const incomeTax = new Decimal(payRun.incomeTaxTotal);
  const eobiEmployee = new Decimal(payRun.eobiEmployeeTotal);
  const eobiEmployer = new Decimal(payRun.eobiEmployerTotal);
  const payrollTaxEmployer = new Decimal(payRun.payrollTaxEmployerTotal);
  const net = new Decimal(payRun.netTotal);
  const employerCost = eobiEmployer.plus(payrollTaxEmployer);

  const jeLines: JournalEntryInput["lines"] = [];
  if (gross.greaterThan(0)) jeLines.push({ accountId: salariesExpense, debit: gross.toFixed(2) });
  if (employerCost.greaterThan(0)) {
    jeLines.push({
      accountId: payrollTaxExpense,
      description: "Employer EOBI & payroll tax",
      debit: employerCost.toFixed(2),
    });
  }
  if (incomeTax.greaterThan(0)) {
    jeLines.push({
      accountId: incomeTaxPayable,
      description: "Income tax withheld",
      credit: incomeTax.toFixed(2),
    });
  }
  const eobiTotal = eobiEmployee.plus(eobiEmployer);
  if (eobiTotal.greaterThan(0)) {
    jeLines.push({ accountId: eobiPayable, description: "EOBI contributions", credit: eobiTotal.toFixed(2) });
  }
  if (payrollTaxEmployer.greaterThan(0)) {
    jeLines.push({
      accountId: payrollTaxPayable,
      description: "Employer payroll tax",
      credit: payrollTaxEmployer.toFixed(2),
    });
  }
  if (net.greaterThan(0)) {
    jeLines.push({ accountId: salariesPayable, description: `Pay run ${payRun.runNumber} net pay`, credit: net.toFixed(2) });
  }

  const { jeId, jeNumber } = await postJournalEntry(
    {
      entityId,
      date: payRun.payDate,
      description: `Pay run ${payRun.runNumber} (${payRun.periodStart} to ${payRun.periodEnd})`,
      reference: payRun.runNumber,
      sourceModule: "payroll",
      lines: jeLines,
    },
    userId
  );

  await db
    .update(payRuns)
    .set({ status: "posted", jeId, postedAt: new Date() })
    .where(eq(payRuns.id, payRunId));

  await writeAudit(db, {
    entityId,
    userId,
    action: "PAY_RUN_POSTED",
    tableName: "pay_runs",
    recordId: payRunId,
    afterState: { runNumber: payRun.runNumber, jeNumber, netTotal: payRun.netTotal },
  });

  return { jeId, jeNumber };
}

export async function markPayRunPaid(
  payRunId: string,
  entityId: string,
  bankAccountId: string,
  userId: string
) {
  const [payRun] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, payRunId), eq(payRuns.entityId, entityId)));
  if (!payRun) throw new PayrollError("Pay run not found");
  if (payRun.status !== "posted") {
    throw new PayrollError(`Only posted pay runs can be paid (this one is ${payRun.status})`);
  }

  const cache = await getMappings(entityId);
  const salariesPayable = await resolveMapping(entityId, "salaries_payable", cache);
  const net = new Decimal(payRun.netTotal);

  const { jeId, jeNumber } = await postJournalEntry(
    {
      entityId,
      date: new Date().toISOString().slice(0, 10),
      description: `Salaries paid — pay run ${payRun.runNumber}`,
      reference: payRun.runNumber,
      sourceModule: "payroll",
      lines: [
        { accountId: salariesPayable, debit: net.toFixed(2) },
        { accountId: bankAccountId, credit: net.toFixed(2) },
      ],
    },
    userId
  );

  await db
    .update(payRuns)
    .set({ status: "paid", paymentJeId: jeId, bankAccountId, paidAt: new Date() })
    .where(eq(payRuns.id, payRunId));

  await writeAudit(db, {
    entityId,
    userId,
    action: "PAY_RUN_PAID",
    tableName: "pay_runs",
    recordId: payRunId,
    afterState: { runNumber: payRun.runNumber, jeNumber, netTotal: payRun.netTotal },
  });

  return { jeId, jeNumber };
}

export async function deletePayRunDraft(payRunId: string, entityId: string, userId: string) {
  const [payRun] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, payRunId), eq(payRuns.entityId, entityId)));
  if (!payRun) throw new PayrollError("Pay run not found");
  if (payRun.status !== "draft") throw new PayrollError("Only draft pay runs can be discarded");

  await writeAudit(db, {
    entityId,
    userId,
    action: "PAY_RUN_DISCARDED",
    tableName: "pay_runs",
    recordId: payRunId,
    beforeState: { runNumber: payRun.runNumber },
  });
  await db.delete(payRuns).where(eq(payRuns.id, payRunId));
}

export async function listPayRuns(entityId: string) {
  const rows = await db
    .select()
    .from(payRuns)
    .where(eq(payRuns.entityId, entityId))
    .orderBy(desc(payRuns.createdAt));
  return rows;
}

export async function getPayRun(payRunId: string, entityId: string) {
  const [payRun] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, payRunId), eq(payRuns.entityId, entityId)));
  if (!payRun) return null;

  const lines = await db
    .select({
      employeeId: payRunLines.employeeId,
      employeeNumber: employees.employeeNumber,
      fullName: employees.fullName,
      basicSalary: payRunLines.basicSalary,
      allowances: payRunLines.allowances,
      grossPay: payRunLines.grossPay,
      incomeTaxAmount: payRunLines.incomeTaxAmount,
      eobiEmployeeAmount: payRunLines.eobiEmployeeAmount,
      eobiEmployerAmount: payRunLines.eobiEmployerAmount,
      payrollTaxEmployerAmount: payRunLines.payrollTaxEmployerAmount,
      netPay: payRunLines.netPay,
    })
    .from(payRunLines)
    .innerJoin(employees, eq(payRunLines.employeeId, employees.id))
    .where(eq(payRunLines.payRunId, payRunId))
    .orderBy(employees.employeeNumber);

  let bankAccount: { accountNumber: string; name: string } | null = null;
  if (payRun.bankAccountId) {
    const [acct] = await db
      .select({ accountNumber: chartOfAccounts.accountNumber, name: chartOfAccounts.name })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.id, payRun.bankAccountId));
    bankAccount = acct ?? null;
  }

  return { payRun, lines, bankAccount };
}
