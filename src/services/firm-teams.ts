import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { firmTeamMembers, firmTeams, users } from "@/db/schema";
import { writeAudit } from "@/services/audit";

export class FirmTeamError extends Error {}

export async function listFirmTeams(firmId: string) {
  const result = await db.execute(sql`
    SELECT t.id, t.name, t.created_at,
      COUNT(DISTINCT m.user_id)::int AS member_count,
      COUNT(DISTINCT je.id)::int AS posted_entries,
      COUNT(DISTINCT je.entity_id)::int AS active_clients
    FROM firm_teams t
    LEFT JOIN firm_team_members m ON m.team_id=t.id AND m.firm_id=t.firm_id
    LEFT JOIN journal_entries je ON je.created_by=m.user_id
      AND je.status='posted' AND je.entity_id IN
        (SELECT id FROM entities WHERE firm_id=${firmId} AND NOT is_firm_books)
    WHERE t.firm_id=${firmId}
    GROUP BY t.id, t.name, t.created_at ORDER BY t.name
  `);
  return result.rows as { id: string; name: string; created_at: Date; member_count: number; posted_entries: number; active_clients: number }[];
}

export async function listTeamMemberships(firmId: string) {
  const rows = await db.select({ userId: firmTeamMembers.userId, teamId: firmTeamMembers.teamId })
    .from(firmTeamMembers).where(eq(firmTeamMembers.firmId, firmId));
  return new Map(rows.map(row => [row.userId, row.teamId]));
}

export async function createFirmTeam(firmId: string, name: string, actingUserId: string) {
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new FirmTeamError("Team name is required");
  return db.transaction(async tx => {
    const [team] = await tx.insert(firmTeams).values({ firmId, name: clean, createdBy: actingUserId }).returning({ id: firmTeams.id });
    await writeAudit(tx, { userId: actingUserId, action: "FIRM_TEAM_CREATED", tableName: "firm_teams", recordId: team.id, afterState: { firmId, name: clean } });
    return team.id;
  });
}

export async function renameFirmTeam(firmId: string, teamId: string, name: string, actingUserId: string) {
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new FirmTeamError("Team name is required");
  return db.transaction(async tx => {
    const [team] = await tx.select({ name: firmTeams.name }).from(firmTeams).where(and(eq(firmTeams.id, teamId), eq(firmTeams.firmId, firmId))).for("update");
    if (!team) throw new FirmTeamError("Team not found");
    await tx.update(firmTeams).set({ name: clean }).where(eq(firmTeams.id, teamId));
    await writeAudit(tx, { userId: actingUserId, action: "FIRM_TEAM_RENAMED", tableName: "firm_teams", recordId: teamId, beforeState: { name: team.name }, afterState: { name: clean } });
  });
}

export async function deleteFirmTeam(firmId: string, teamId: string, actingUserId: string) {
  return db.transaction(async tx => {
    const [team] = await tx.select({ name: firmTeams.name }).from(firmTeams).where(and(eq(firmTeams.id, teamId), eq(firmTeams.firmId, firmId))).for("update");
    if (!team) throw new FirmTeamError("Team not found");
    await tx.delete(firmTeams).where(eq(firmTeams.id, teamId));
    await writeAudit(tx, { userId: actingUserId, action: "FIRM_TEAM_DELETED", tableName: "firm_teams", recordId: teamId, beforeState: { name: team.name, firmId } });
  });
}

export async function assignUserToTeam(firmId: string, userId: string, teamId: string | null, actingUserId: string) {
  return db.transaction(async tx => {
    const [member] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.firmId, firmId)));
    if (!member) throw new FirmTeamError("User not found in this firm");
    if (teamId) {
      const [team] = await tx.select({ id: firmTeams.id }).from(firmTeams).where(and(eq(firmTeams.id, teamId), eq(firmTeams.firmId, firmId)));
      if (!team) throw new FirmTeamError("Team not found in this firm");
    }
    const [before] = await tx.select({ teamId: firmTeamMembers.teamId }).from(firmTeamMembers).where(eq(firmTeamMembers.userId, userId));
    if (teamId) await tx.insert(firmTeamMembers).values({ firmId, teamId, userId }).onConflictDoUpdate({ target: firmTeamMembers.userId, set: { teamId } });
    else await tx.delete(firmTeamMembers).where(eq(firmTeamMembers.userId, userId));
    await writeAudit(tx, { userId: actingUserId, action: "FIRM_TEAM_MEMBERSHIP_CHANGED", tableName: "firm_team_members", recordId: userId,
      beforeState: { teamId: before?.teamId ?? null }, afterState: { teamId } });
  });
}
