import "server-only";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, entities, firmBudgets, firmClientLinks, firmStaffRates, firmTimeEntries, users } from "@/db/schema";
import { writeAudit } from "@/services/audit";
import { getFirmBooks } from "@/services/firms";
import { getProfitAndLoss } from "@/services/statements";
import { formatCents, parseCents } from "@/lib/money";

function amount(value: string, label: string) {
  const n = new Decimal(value);
  if (!n.isFinite() || n.isNegative() || n.decimalPlaces() > 2) throw new Error(`${label} must be a nonnegative amount with at most two decimals`);
  return n.toFixed(2);
}
function validDate(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}

export async function listFirmBookCustomers(firmId: string) {
  const books = await getFirmBooks(firmId);
  if (!books) return [];
  return db.select({id:contacts.id,name:contacts.name}).from(contacts)
    .where(and(eq(contacts.entityId,books.id),eq(contacts.type,"customer"),eq(contacts.isActive,true)));
}

export async function listFirmClientLinks(firmId: string) {
  return db.select({clientEntityId:firmClientLinks.clientEntityId,customerContactId:firmClientLinks.customerContactId})
    .from(firmClientLinks).where(eq(firmClientLinks.firmId,firmId));
}

export async function linkFirmClient(firmId: string, clientEntityId: string, customerContactId: string | null, actingUserId: string) {
  return db.transaction(async tx => {
    const [client] = await tx.select({id:entities.id}).from(entities)
      .where(and(eq(entities.id,clientEntityId),eq(entities.firmId,firmId),eq(entities.isFirmBooks,false)));
    if (!client) throw new Error("Client not found in this firm");
    if (customerContactId) {
      const [books] = await tx.select({id:entities.id}).from(entities).where(and(eq(entities.firmId,firmId),eq(entities.isFirmBooks,true)));
      const [customer] = books ? await tx.select({id:contacts.id}).from(contacts)
        .where(and(eq(contacts.id,customerContactId),eq(contacts.entityId,books.id),eq(contacts.type,"customer"))) : [];
      if (!customer) throw new Error("Choose a customer in the firm books");
    }
    const [before] = await tx.select().from(firmClientLinks).where(eq(firmClientLinks.clientEntityId,clientEntityId));
    if (customerContactId) await tx.insert(firmClientLinks).values({firmId,clientEntityId,customerContactId})
      .onConflictDoUpdate({target:firmClientLinks.clientEntityId,set:{customerContactId}});
    else await tx.delete(firmClientLinks).where(eq(firmClientLinks.clientEntityId,clientEntityId));
    await writeAudit(tx,{entityId:clientEntityId,userId:actingUserId,action:"FIRM_CLIENT_CUSTOMER_LINKED",
      tableName:"firm_client_links",recordId:clientEntityId,beforeState:{customerContactId:before?.customerContactId ?? null},afterState:{customerContactId}});
  });
}

export async function listFirmStaffRates(firmId: string) {
  return db.select({userId:firmStaffRates.userId,hourlyCost:firmStaffRates.hourlyCost,
    capacityHoursWeek:firmStaffRates.capacityHoursWeek}).from(firmStaffRates).where(eq(firmStaffRates.firmId,firmId));
}

export async function setFirmStaffRate(firmId: string, userId: string, hourlyCost: string, capacityHoursWeek: string, actingUserId: string) {
  const cost = amount(hourlyCost,"Hourly cost");
  const capacity = new Decimal(capacityHoursWeek);
  if (!capacity.isFinite() || !capacity.isPositive() || capacity.greaterThan(168) || capacity.decimalPlaces()>2) throw new Error("Weekly capacity must be between 0 and 168 hours");
  return db.transaction(async tx => {
    const [member] = await tx.select({id:users.id,role:users.role,isActive:users.isActive}).from(users).where(and(eq(users.id,userId),eq(users.firmId,firmId)));
    if (!member) throw new Error("Team member not found in this firm");
    if (!member.isActive || !["firm_owner","firm_admin","accountant_staff"].includes(member.role)) throw new Error("Choose an active firm team member");
    const [before] = await tx.select().from(firmStaffRates).where(eq(firmStaffRates.userId,userId));
    const next = {hourlyCost:cost,capacityHoursWeek:capacity.toFixed(2),updatedAt:new Date()};
    await tx.insert(firmStaffRates).values({firmId,userId,...next}).onConflictDoUpdate({target:firmStaffRates.userId,set:next});
    await writeAudit(tx,{userId:actingUserId,action:"FIRM_STAFF_RATE_UPDATED",tableName:"firm_staff_rates",recordId:userId,
      beforeState:before ?? null,afterState:{hourlyCost:cost,capacityHoursWeek:next.capacityHoursWeek}});
  });
}

export async function recordFirmTime(input: {firmId:string;clientEntityId:string;userId:string;workDate:string;hours:string;billable:boolean;description:string}, actingUserId:string) {
  if (!validDate(input.workDate)) throw new Error("Enter a valid work date");
  const hours = new Decimal(input.hours);
  if (!hours.isFinite() || !hours.isPositive() || hours.greaterThan(24) || hours.decimalPlaces()>2) throw new Error("Hours must be between 0 and 24");
  const description = input.description.trim();
  if (!description || description.length>1000) throw new Error("Describe the work in 1 to 1000 characters");
  return db.transaction(async tx => {
    const [client] = await tx.select({id:entities.id}).from(entities)
      .where(and(eq(entities.id,input.clientEntityId),eq(entities.firmId,input.firmId),eq(entities.isFirmBooks,false)));
    const [rate] = await tx.select({hourlyCost:firmStaffRates.hourlyCost}).from(firmStaffRates)
      .where(and(eq(firmStaffRates.userId,input.userId),eq(firmStaffRates.firmId,input.firmId))).for("share");
    if (!client) throw new Error("Client not found in this firm");
    if (!rate) throw new Error("Set this team member's hourly cost before recording time");
    const [entry] = await tx.insert(firmTimeEntries).values({...input,hours:hours.toFixed(2),hourlyCost:rate.hourlyCost,description,
      createdBy:actingUserId}).returning({id:firmTimeEntries.id});
    await writeAudit(tx,{entityId:input.clientEntityId,userId:actingUserId,action:"FIRM_TIME_RECORDED",tableName:"firm_time_entries",recordId:entry.id,
      afterState:{memberId:input.userId,workDate:input.workDate,hours:hours.toFixed(2),hourlyCost:rate.hourlyCost,billable:input.billable}});
    return entry.id;
  });
}

export async function listFirmTime(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`SELECT t.id,t.work_date,t.hours,t.hourly_cost,t.billable,t.description,
      u.full_name AS member_name,e.name AS client_name
    FROM firm_time_entries t JOIN users u ON u.id=t.user_id JOIN entities e ON e.id=t.client_entity_id
    WHERE t.firm_id=${firmId} AND t.work_date BETWEEN ${from} AND ${to}
    ORDER BY t.work_date DESC,t.created_at DESC LIMIT 100`);
  return result.rows as {id:string;work_date:string;hours:string;hourly_cost:string;billable:boolean;description:string;member_name:string;client_name:string}[];
}

export async function deleteFirmTime(firmId:string, entryId:string, actingUserId:string) {
  return db.transaction(async tx=>{
    const [entry]=await tx.select().from(firmTimeEntries)
      .where(and(eq(firmTimeEntries.id,entryId),eq(firmTimeEntries.firmId,firmId))).for("update");
    if (!entry) throw new Error("Time entry not found in this firm");
    await tx.delete(firmTimeEntries).where(eq(firmTimeEntries.id,entryId));
    await writeAudit(tx,{entityId:entry.clientEntityId,userId:actingUserId,action:"FIRM_TIME_REMOVED",
      tableName:"firm_time_entries",recordId:entryId,beforeState:entry});
  });
}

export async function setFirmBudget(firmId: string, monthStart: string, revenueTarget: string, expenseBudget: string, actingUserId: string) {
  if (!validDate(monthStart) || !monthStart.endsWith("-01")) throw new Error("Choose the first day of a month");
  const books = await getFirmBooks(firmId);
  if (!books) throw new Error("Set up firm books before entering a budget");
  const next = {currency:books.baseCurrency,revenueTarget:amount(revenueTarget,"Revenue target"),
    expenseBudget:amount(expenseBudget,"Expense budget"),updatedAt:new Date()};
  return db.transaction(async tx => {
    const [before] = await tx.select().from(firmBudgets).where(and(eq(firmBudgets.firmId,firmId),eq(firmBudgets.monthStart,monthStart)));
    await tx.insert(firmBudgets).values({firmId,monthStart,...next})
      .onConflictDoUpdate({target:[firmBudgets.firmId,firmBudgets.monthStart],set:next});
    await writeAudit(tx,{userId:actingUserId,action:"FIRM_BUDGET_UPDATED",tableName:"firm_budgets",
      beforeState:before ?? null,afterState:{monthStart,...next}});
  });
}

export async function firmClientContribution(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`
    SELECT e.id,e.name,c.name AS customer_name,
      COALESCE((SELECT SUM(l.credit_base-l.debit_base) FROM journal_entries je
        JOIN journal_entry_lines l ON l.je_id=je.id JOIN chart_of_accounts a ON a.id=l.account_id
        WHERE je.status IN ('posted','voided') AND je.date BETWEEN ${from} AND ${to}
          AND a.type IN ('revenue','other_income') AND (
            EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id=link.customer_contact_id AND (i.je_id=je.id OR i.je_id=je.reverses_je_id))
            OR EXISTS (SELECT 1 FROM settlements s JOIN invoices i ON i.id=s.invoice_id
              WHERE s.kind='credit_note' AND i.customer_id=link.customer_contact_id
                AND (s.je_id=je.id OR s.je_id=je.reverses_je_id))
          )),0) AS invoice_revenue,
      COALESCE((SELECT ROUND(SUM(t.hours*t.hourly_cost),2) FROM firm_time_entries t
        WHERE t.client_entity_id=e.id AND t.work_date BETWEEN ${from} AND ${to}),0) AS time_cost,
      COALESCE((SELECT SUM(t.hours) FROM firm_time_entries t
        WHERE t.client_entity_id=e.id AND t.work_date BETWEEN ${from} AND ${to}),0) AS hours
    FROM entities e LEFT JOIN firm_client_links link ON link.client_entity_id=e.id
    LEFT JOIN contacts c ON c.id=link.customer_contact_id
    WHERE e.firm_id=${firmId} AND NOT e.is_firm_books
    ORDER BY e.name`);
  return (result.rows as {id:string;name:string;customer_name:string|null;invoice_revenue:string;time_cost:string;hours:string}[])
    .map(row=>({...row,invoice_revenue:formatCents(parseCents(row.invoice_revenue)),time_cost:formatCents(parseCents(row.time_cost)),
      contribution:formatCents(parseCents(row.invoice_revenue)-parseCents(row.time_cost))}));
}

export async function firmStaffUtilisation(firmId: string, from: string, to: string) {
  const result = await db.execute(sql`SELECT u.id,u.full_name,r.hourly_cost,r.capacity_hours_week,
    COALESCE(SUM(t.hours),0) AS recorded_hours,
    COALESCE(SUM(t.hours) FILTER (WHERE t.billable),0) AS billable_hours
    FROM users u LEFT JOIN firm_staff_rates r ON r.user_id=u.id AND r.firm_id=${firmId}
    LEFT JOIN firm_time_entries t ON t.user_id=u.id AND t.firm_id=${firmId} AND t.work_date BETWEEN ${from} AND ${to}
    WHERE u.firm_id=${firmId} AND u.is_active
    GROUP BY u.id,u.full_name,r.hourly_cost,r.capacity_hours_week ORDER BY u.full_name`);
  const days = Math.max(1,Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1);
  return (result.rows as {id:string;full_name:string;hourly_cost:string|null;capacity_hours_week:string|null;recorded_hours:string;billable_hours:string}[])
    .map(row=>{const capacity=row.capacity_hours_week?new Decimal(row.capacity_hours_week).times(days).div(7):null;
      return {...row,capacity_hours:capacity?.toFixed(2) ?? null,
        utilisation_pct:capacity?.greaterThan(0)?new Decimal(row.billable_hours).times(100).div(capacity).toFixed(1):null};});
}

export async function firmBudgetVsActual(firmId: string, from: string, to: string) {
  const books = await getFirmBooks(firmId);
  if (!books) return [];
  const start = new Date(`${from.slice(0,7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0,7)}-01T00:00:00Z`);
  const months: string[] = [];
  while (start <= end && months.length < 24) { months.push(start.toISOString().slice(0,10));start.setUTCMonth(start.getUTCMonth()+1); }
  const budgets = await db.select().from(firmBudgets).where(eq(firmBudgets.firmId,firmId));
  return Promise.all(months.map(async monthStart=>{
    const monthEnd=new Date(Date.UTC(Number(monthStart.slice(0,4)),Number(monthStart.slice(5,7)),0)).toISOString().slice(0,10);
    const pl=await getProfitAndLoss(books.id,monthStart<from?from:monthStart,monthEnd>to?to:monthEnd);
    const revenue=formatCents(parseCents(pl.revenue.net)+parseCents(pl.otherIncome.total));
    const expenses=formatCents(parseCents(pl.cogs.net)+parseCents(pl.operatingExpenses.total)+parseCents(pl.otherExpense.total)+parseCents(pl.incomeTax.total));
    const budget=budgets.find(b=>b.monthStart===monthStart);
    return {monthStart,currency:books.baseCurrency,revenue,expenses,revenueTarget:budget?.revenueTarget??null,expenseBudget:budget?.expenseBudget??null};
  }));
}
