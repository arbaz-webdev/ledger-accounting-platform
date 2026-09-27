"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession, verifyPassword, homePathFor } from "@/lib/auth";
import { writeAudit } from "@/services/audit";
import type { UserRole } from "@/lib/auth";
import { allowAuthAttempt, verifyMfa } from "@/services/auth-security";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required" };
  if (email.length > 254 || Buffer.byteLength(password) > 72) return { error: "Invalid email or password" };
  if (!(await allowAuthAttempt("login", email))) return { error: "Too many attempts. Try again in 15 minutes." };

  const rows = await db.select().from(users).where(eq(users.email, email));
  const user = rows[0];
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Invalid email or password" };
  }

  const signedIn = await db.transaction(async (tx) => {
    const current = await tx.execute(sql`SELECT password_hash, is_active FROM users WHERE id = ${user.id} FOR UPDATE`);
    if (!current.rows[0]?.is_active || current.rows[0].password_hash !== user.passwordHash) return false;
    if (!(await verifyMfa(tx, user.id, String(formData.get("code") ?? "")))) return false;
    await createSession(user.id, tx);
    await writeAudit(tx, { userId: user.id, action: "LOGIN" });
    return true;
  });
  if (!signedIn) return { error: "A valid, unused authenticator code is required." };

  // Each tier has its own portal; the role decides where you land.
  redirect(homePathFor(user.role as UserRole));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
