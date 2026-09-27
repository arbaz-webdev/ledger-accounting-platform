import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tokenHash } from "@/lib/security";
import { verifyMfa } from "@/services/auth-security";
import { writeAudit } from "@/services/audit";

/** Hashes and tokens never leave this transaction; competing resets serialize. */
export async function completePasswordReset(token: string, passwordHash: string, code: string): Promise<boolean> {
  return db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT user_id FROM password_reset_tokens WHERE token_hash = ${tokenHash(token)}
      AND expires_at > now() FOR UPDATE`);
    const user = result.rows[0];
    if (!user) return false;
    const current = await tx.execute(sql`SELECT id FROM users WHERE id = ${user.user_id} AND is_active FOR UPDATE`);
    if (!current.rows.length || !(await verifyMfa(tx, String(user.user_id), code))) return false;
    await tx.execute(sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${user.user_id}`);
    await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${user.user_id}`);
    await tx.execute(sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.user_id}`);
    await writeAudit(tx, { userId: String(user.user_id), action: "PASSWORD_RESET" });
    return true;
  });
}
