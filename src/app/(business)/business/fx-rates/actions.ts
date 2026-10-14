"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "@/lib/business-guard";
import { setFxRate } from "@/services/fx";

export async function setBusinessFxRateAction(form:FormData) {
  const ctx=await portalContext();
  if (ctx.user.role!=="business_admin") redirect("/business?denied=fx-rates");
  try {await setFxRate(ctx.entityId,{currency:String(form.get("currency")??""),asOfDate:String(form.get("asOfDate")??""),rate:String(form.get("rate")??"")},ctx.user.id);}
  catch(error){redirect(`/business/fx-rates?error=${encodeURIComponent(error instanceof Error?error.message:"Could not save rate")}`);}
  revalidatePath("/business/fx-rates");
  redirect("/business/fx-rates?saved=1");
}
