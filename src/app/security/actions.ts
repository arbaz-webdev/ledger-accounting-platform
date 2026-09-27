"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { Secret } from "otpauth";
import { db } from "@/db";
import { requireUser, verifyPassword, hashPassword } from "@/lib/auth";
import { encryptSecret, decryptSecret, totpStep, validatePassword } from "@/lib/security";
import { allowAuthAttempt, verifyMfa } from "@/services/auth-security";
import { writeAudit } from "@/services/audit";

async function confirmPassword(userId: string, password: string) {
  const result = await db.execute(sql`SELECT password_hash FROM users WHERE id = ${userId}`);
  return verifyPassword(password, String(result.rows[0].password_hash));
}
export async function beginMfa(form: FormData) {
  const user = await requireUser();
  if (!(await allowAuthAttempt("security", user.email)) || !(await confirmPassword(user.id, String(form.get("password") ?? "")))) {
    redirect("/security?notice=Password+verification+failed");
  }
  const secret = encryptSecret(new Secret({ size: 20 }).base32);
  await db.execute(sql`
    INSERT INTO user_security (user_id, mfa_secret) VALUES (${user.id}, ${secret})
    ON CONFLICT (user_id) DO UPDATE SET mfa_secret = EXCLUDED.mfa_secret
    WHERE NOT user_security.mfa_enabled
  `);
  redirect("/security?notice=Enter+the+setup+key+in+your+authenticator+then+confirm+a+code");
}
export async function enableMfa(form: FormData) {
  const user = await requireUser();
  if (!(await allowAuthAttempt("security", user.email))) redirect("/security?notice=Try+again+in+15+minutes");
  const currentToken = (await cookies()).get("session")?.value ?? "";
  const ok = await db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT * FROM user_security WHERE user_id = ${user.id} FOR UPDATE`);
    const row = result.rows[0];
    if (!row?.mfa_secret || row.mfa_enabled) return false;
    const step = totpStep(decryptSecret(String(row.mfa_secret)), String(form.get("code") ?? ""));
    if (step === null) return false;
    await tx.execute(sql`UPDATE user_security SET mfa_enabled = true, last_totp_step = ${step} WHERE user_id = ${user.id}`);
    await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${user.id} AND token <> ${currentToken}`);
    await writeAudit(tx, { userId: user.id, action: "MFA_ENABLED" });
    return true;
  });
  redirect("/security?notice=" + (ok ? "MFA+enabled" : "Invalid+code"));
}
export async function changePassword(form: FormData) {
  const user = await requireUser();
  if (!(await allowAuthAttempt("security", user.email)) || !(await confirmPassword(user.id, String(form.get("password") ?? "")))) {
    redirect("/security?notice=Password+verification+failed");
  }
  const password = String(form.get("newPassword") ?? "");
  try { validatePassword(password); } catch { redirect("/security?notice=Use+12+characters+minimum+and+72+UTF8+bytes+maximum"); }
  const hash = await hashPassword(password);
  const ok = await db.transaction(async tx => {
    const current = await tx.execute(sql`SELECT password_hash FROM users WHERE id = ${user.id} AND is_active FOR UPDATE`);
    if (!current.rows[0] || !(await verifyPassword(String(form.get("password") ?? ""), String(current.rows[0].password_hash)))) return false;
    if (!(await verifyMfa(tx, user.id, String(form.get("code") ?? "")))) return false;
    await tx.execute(sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`);
    await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${user.id}`);
    await tx.execute(sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`);
    await writeAudit(tx, { userId: user.id, action: "PASSWORD_CHANGED" });
    return true;
  });
  if (!ok) redirect("/security?notice=Invalid+authenticator+code");
  (await cookies()).delete("session");
  redirect("/login");
}
