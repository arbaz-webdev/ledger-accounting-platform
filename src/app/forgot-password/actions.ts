"use server";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { hashPassword } from "@/lib/auth";
import { tokenHash, validatePassword } from "@/lib/security";
import { allowAuthAttempt } from "@/services/auth-security";
import { completePasswordReset } from "@/services/password-recovery";

export async function requestReset(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const notice = "/forgot-password?notice=If+the+account+exists+and+email+delivery+is+configured,+a+reset+link+will+be+sent";
  if (!email || email.length > 254 || !(await allowAuthAttempt("reset-request", email))) redirect(notice);
  const result = await db.execute(sql`SELECT id FROM users WHERE email = ${email} AND is_active`);
  const user = result.rows[0];
  const origin = process.env.APP_URL;
  if (user && process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM && origin?.startsWith("https://")) {
    const token = randomBytes(32).toString("hex");
    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`);
      await tx.execute(sql`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
        VALUES (${tokenHash(token)}, ${user.id}, now() + interval '30 minutes')`);
    });
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [email], subject: "Reset your Ledger password",
          text: "Reset your password within 30 minutes: " + new URL("/reset-password?token=" + token, origin).href + "\nIf you did not request this, ignore this email." })
      });
      if (!response.ok) console.error("Password reset delivery failed", response.status);
    } catch { console.error("Password reset delivery unavailable"); }
  }
  redirect(notice);
}
export async function resetPassword(form: FormData) {
  const token = String(form.get("token") ?? "");
  const failure = "/reset-password?notice=Invalid+or+expired+link,+password,+or+authenticator+code";
  if (!/^[a-f0-9]{64}$/.test(token) || !(await allowAuthAttempt("reset-confirm", tokenHash(token)))) redirect(failure);
  const password = String(form.get("password") ?? "");
  try { validatePassword(password); } catch { redirect(failure); }
  const hash = await hashPassword(password);
  const ok = await completePasswordReset(token, hash, String(form.get("code") ?? ""));
  if (!ok) redirect(failure);
  redirect("/login");
}
