import "server-only";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { tokenHash, decryptSecret, totpStep } from "@/lib/security";

/** Shared durable limits: reserving an attempt is atomic across serverless instances. */
export async function allowAuthAttempt(purpose: string, email: string): Promise<boolean> {
  const requestHeaders = await headers();
  const ip = process.env.VERCEL ? requestHeaders.get("x-vercel-forwarded-for")?.split(",")[0].trim() : null;
  const buckets = [{ key: purpose + ":account:" + email.toLowerCase(), limit: 8 }];
  if (ip) buckets.push({ key: purpose + ":ip:" + ip, limit: 40 });
  let allowed = true;
  for (const bucket of buckets) {
    if (!(await reserveAuthBucket(bucket.key, bucket.limit))) allowed = false;
  }
  // Bound storage growth from random email addresses; active buckets remain intact.
  await db.execute(sql`DELETE FROM auth_rate_limits WHERE window_started_at < now() - interval '1 day'`);
  return allowed;
}
export async function verifyMfa(tx: Tx, userId: string, code: string): Promise<boolean> {
  const result = await tx.execute(sql`SELECT * FROM user_security WHERE user_id = ${userId} FOR UPDATE`);
  const row = result.rows[0];
  if (!row?.mfa_enabled) return true;
  const step = totpStep(decryptSecret(String(row.mfa_secret)), code);
  if (step === null || step <= Number(row.last_totp_step)) return false;
  await tx.execute(sql`UPDATE user_security SET last_totp_step = ${step} WHERE user_id = ${userId}`);
  return true;
}

export async function reserveAuthBucket(key: string, limit: number): Promise<boolean> {
    const result = await db.execute(sql`
      INSERT INTO auth_rate_limits (key) VALUES (${tokenHash(key)})
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_started_at < now() - interval '15 minutes'
          THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_started_at = CASE WHEN auth_rate_limits.window_started_at < now() - interval '15 minutes'
          THEN now() ELSE auth_rate_limits.window_started_at END
      RETURNING attempts
    `);
    return Number(result.rows[0].attempts) <= limit;
}
