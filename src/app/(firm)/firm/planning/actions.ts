"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFirmOwner } from "@/lib/auth";
import { linkFirmClient, setFirmStaffRate, recordFirmTime, deleteFirmTime, setFirmBudget } from "@/services/firm-planning";

function fail(error:unknown):never {
  redirect(`/firm/planning?error=${encodeURIComponent(error instanceof Error?error.message:"Could not save")}`);
}
function done():never {
  revalidatePath("/firm/planning");
  revalidatePath("/firm/reports");
  redirect("/firm/planning?saved=1");
}

export async function linkFirmClientAction(form:FormData) {
  const owner=await requireFirmOwner();
  try {await linkFirmClient(owner.firmId,String(form.get("clientEntityId")),String(form.get("customerContactId")||"")||null,owner.id);}
  catch(error){fail(error);} done();
}
export async function setFirmStaffRateAction(form:FormData) {
  const owner=await requireFirmOwner();
  try {await setFirmStaffRate(owner.firmId,String(form.get("userId")),String(form.get("hourlyCost")),String(form.get("capacityHoursWeek")),owner.id);}
  catch(error){fail(error);} done();
}
export async function recordFirmTimeAction(form:FormData) {
  const owner=await requireFirmOwner();
  try {await recordFirmTime({firmId:owner.firmId,clientEntityId:String(form.get("clientEntityId")),userId:String(form.get("userId")),
    workDate:String(form.get("workDate")),hours:String(form.get("hours")),billable:String(form.get("billable"))==="true",
    description:String(form.get("description")??"")},owner.id);}
  catch(error){fail(error);} done();
}
export async function deleteFirmTimeAction(form:FormData) {
  const owner=await requireFirmOwner();
  try {await deleteFirmTime(owner.firmId,String(form.get("entryId")),owner.id);}
  catch(error){fail(error);} done();
}
export async function setFirmBudgetAction(form:FormData) {
  const owner=await requireFirmOwner();
  const month=String(form.get("month"));
  try {await setFirmBudget(owner.firmId,`${month}-01`,String(form.get("revenueTarget")),String(form.get("expenseBudget")),owner.id);}
  catch(error){fail(error);} done();
}
