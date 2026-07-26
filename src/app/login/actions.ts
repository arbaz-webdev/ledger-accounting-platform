"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession, verifyPassword, ACCOUNTANT_ROLES } from "@/lib/auth";
import { writeAudit } from "@/services/audit";
import type { UserRole } from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required" };

  const rows = await db.select().from(users).where(eq(users.email, email));
  const user = rows[0];
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Invalid email or password" };
  }

  await createSession(user.id);
  await writeAudit(db, { userId: user.id, action: "LOGIN" });

  redirect(ACCOUNTANT_ROLES.includes(user.role as UserRole) ? "/accountant" : "/business");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
