"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { LogoMark, Wordmark } from "@/components/logo";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <main className="flex min-h-screen">
      {/* Brand panel */}
      <aside className="sidebar ledger-grid relative hidden w-[44%] flex-col justify-between p-10 lg:flex">
        <Wordmark dark />
        <div>
          <div className="max-w-md">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
              Every entry balanced.
              <br />
              <span className="text-[var(--brand-500)]">Every report live.</span>
            </h2>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-[#aeb7c4]">
              Double-entry bookkeeping for accounting firms and their clients — one ledger,
              real-time statements, and an audit trail that never forgets.
            </p>
          </div>

          {/* Mini ledger vignette */}
          <div className="mt-10 max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[0.6875rem] font-semibold uppercase tracking-widest text-[#5f6b7d]">
              <span>Journal entry #142</span>
              <span className="text-[var(--brand-500)]">Balanced</span>
            </div>
            <div className="mt-2 space-y-1.5 font-mono text-[0.78rem] text-[#c6cdd7]">
              <div className="flex justify-between">
                <span>1200 · Accounts Receivable</span>
                <span className="num">12,000.00</span>
              </div>
              <div className="flex justify-between">
                <span className="pl-4">4000 · Sales Revenue</span>
                <span className="num">12,000.00</span>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-[#5f6b7d]">
          Confidential — for authorised firm and client users only.
        </p>
      </aside>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center bg-[var(--paper)] p-6">
        <div className="w-full max-w-[24rem]">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <div className="card fade-up p-8" style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="mb-6 hidden lg:block">
              <LogoMark size={36} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-900)]">
              Sign in to your workspace
            </h1>
            <p className="mt-1 text-[0.8125rem] text-[var(--ink-500)]">
              Accountants and business users share one door.
            </p>

            <form action={formAction} className="mt-6 space-y-4">
              {state.error && (
                <p className="banner banner-error" role="alert">
                  {state.error}
                </p>
              )}

              <div>
                <label className="field-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@firm.com"
                  className="input"
                />
              </div>

              <div>
                <label className="field-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="input"
                />
              </div>

              <button type="submit" disabled={pending} className="btn btn-primary w-full">
                {pending ? "Signing in…" : "Sign in"}
              </button>
              <div>
                <label className="field-label" htmlFor="code">Authenticator code (if enabled)</label>
                <input id="code" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
              </div>
              <a href="/forgot-password" className="btn btn-ghost">Forgot password?</a>
            </form>
          </div>
          <p className="mt-6 text-center text-xs text-[var(--ink-400)]">
            Ledger · double-entry accounting platform
          </p>
        </div>
      </section>
    </main>
  );
}
