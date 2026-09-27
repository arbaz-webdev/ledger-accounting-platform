import { resetPassword } from "@/app/forgot-password/actions";
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string; notice?: string }> }) {
  const { token, notice } = await searchParams;
  return <main className="mx-auto max-w-md space-y-5 p-6">
    <h1 className="text-xl font-semibold">Choose a new password</h1>
    {notice && <p className="banner" role="status">{notice}</p>}
    <form action={resetPassword} className="card space-y-4 p-6">
      <input type="hidden" name="token" value={token ?? ""} />
      <label className="field-label" htmlFor="password">New password (12 characters minimum)</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} className="input" required />
      <label className="field-label" htmlFor="code">Authenticator code (if MFA enabled)</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input" />
      <button className="btn btn-primary">Reset password</button>
    </form>
    <a className="btn btn-ghost" href="/forgot-password">Request a new link</a>
  </main>;
}
