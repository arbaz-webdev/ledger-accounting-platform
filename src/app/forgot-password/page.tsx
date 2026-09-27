import { requestReset } from "./actions";
export default async function ForgotPassword({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  return <main className="mx-auto max-w-md space-y-5 p-6">
    <h1 className="text-xl font-semibold">Reset your password</h1>
    {notice && <p className="banner" role="status">{notice}</p>}
    <form action={requestReset} className="card space-y-4 p-6">
      <label className="field-label" htmlFor="email">Account email</label>
      <input id="email" name="email" type="email" autoComplete="email" className="input" maxLength={254} required />
      <button className="btn btn-primary">Send reset link</button>
    </form>
    <a className="btn btn-ghost" href="/login">Back to sign in</a>
  </main>;
}
