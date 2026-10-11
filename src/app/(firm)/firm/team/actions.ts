"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFirmOwner } from "@/lib/auth";
import { createFirmTeam, renameFirmTeam, deleteFirmTeam, assignUserToTeam } from "@/services/firm-teams";
import { deleteFirmUser, getFirmUser } from "@/services/users";

function fail(error: unknown): never {
  redirect(`/firm/team?error=${encodeURIComponent(error instanceof Error ? error.message : "Action failed")}`);
}

export async function createTeamAction(form: FormData) {
  const user = await requireFirmOwner();
  try { await createFirmTeam(user.firmId, String(form.get("name") ?? ""), user.id); } catch (error) { fail(error); }
  revalidatePath("/firm/team"); revalidatePath("/firm"); redirect("/firm/team");
}

export async function renameTeamAction(form: FormData) {
  const user = await requireFirmOwner();
  try { await renameFirmTeam(user.firmId, String(form.get("teamId")), String(form.get("name") ?? ""), user.id); } catch (error) { fail(error); }
  revalidatePath("/firm/team"); revalidatePath("/firm"); redirect("/firm/team");
}

export async function deleteTeamAction(form: FormData) {
  const user = await requireFirmOwner();
  try { await deleteFirmTeam(user.firmId, String(form.get("teamId")), user.id); } catch (error) { fail(error); }
  revalidatePath("/firm/team"); revalidatePath("/firm"); redirect("/firm/team");
}

export async function assignTeamAction(form: FormData) {
  const user = await requireFirmOwner();
  try { await assignUserToTeam(user.firmId, String(form.get("userId")), String(form.get("teamId") || "") || null, user.id); } catch (error) { fail(error); }
  revalidatePath("/firm/team"); revalidatePath("/firm"); redirect(`/firm/team?user=${encodeURIComponent(String(form.get("userId")))}`);
}

export async function deleteMemberAction(form: FormData) {
  const user = await requireFirmOwner();
  const targetId = String(form.get("userId"));
  const target = await getFirmUser(targetId, user.firmId);
  if (!target || String(form.get("confirmEmail")) !== target.user.email) fail(new Error("Enter the user's exact email to confirm deletion"));
  try { await deleteFirmUser(targetId, user.firmId, user.id); } catch (error) { fail(error); }
  revalidatePath("/firm/team"); revalidatePath("/firm"); redirect("/firm/team");
}
