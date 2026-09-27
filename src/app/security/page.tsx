import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, homePathFor } from "@/lib/auth";
import { decryptSecret } from "@/lib/security";
import { beginMfa, enableMfa, changePassword } from "./actions";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await requireUser();
  const { notice } = await searchParams;
  const result = await db.execute(sql`SELECT * FROM user_security WHERE user_id = ${user.id}`);
  const row = result.rows[0];
  const configured = /^[a-f0-9]{64}$/i.test(process.env.AUTH_ENCRYPTION_KEY ?? "");
  return <main className="mx-auto max-w-xl space-y-6 p-6">
    <a href={homePathFor(user.role)} className="btn btn-ghost">Back to workspace</a>
    <h1 className="text-xl font-semibold">Account security</h1>
    {notice && <p className="banner" role="status">{notice}</p>}
    <section className="card space-y-4 p-6">
      <h2 className="font-semibold">Authenticator-app MFA</h2>
      {row?.mfa_enabled ? <p>MFA is enabled. Keep your authenticator backed up securely. Password recovery also requires your authenticator code.</p> : !configured ? <p>Your administrator must configure MFA encryption before setup is available.</p> : <>
        <form action={beginMfa} className="space-y-3">
          <label className="field-label" htmlFor="setupPassword">Current password</label>
          <input className="input" id="setupPassword" name="password" type="password" autoComplete="current-password" required />
          <button className="btn btn-primary">Generate setup key</button>
        </form>
        {row?.mfa_secret && <>
          <p>Add this key to your authenticator using a time-based, six-digit account named Ledger:</p>
          <code className="block break-all">{decryptSecret(String(row.mfa_secret))}</code>
          <form action={enableMfa} className="space-y-3">
            <label className="field-label" htmlFor="setupCode">Confirmation code</label>
            <input className="input" id="setupCode" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
            <button className="btn btn-primary">Enable MFA</button>
          </form>
        </>}
      </>}
    </section>
    <section className="card space-y-4 p-6">
      <h2 className="font-semibold">Change password</h2>
      <form action={changePassword} className="space-y-3">
        <label className="field-label" htmlFor="oldPassword">Current password</label>
        <input id="oldPassword" name="password" className="input" type="password" autoComplete="current-password" required />
        <label className="field-label" htmlFor="newPassword">New password (12 characters minimum)</label>
        <input id="newPassword" name="newPassword" className="input" type="password" autoComplete="new-password" minLength={12} required />
        <label className="field-label" htmlFor="changeCode">Authenticator code (if enabled)</label>
        <input id="changeCode" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        <button className="btn btn-primary">Change password and sign out everywhere</button>
      </form>
    </section>
  </main>;
}
