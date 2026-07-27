import { getCurrentUser } from "@/lib/auth";
import { firmAccessState } from "@/services/subscriptions";
import { logout } from "@/app/login/actions";
import { Wordmark } from "@/components/logo";
import { IconShield } from "@/components/icons";

/**
 * Where the subscription gate sends firm users when access is revoked.
 * Deliberately outside every portal layout so it can't loop through the gate.
 */
export default async function SuspendedPage() {
  const user = await getCurrentUser();
  const access = user?.firmId ? await firmAccessState(user.firmId) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <Wordmark />
      </div>
      <div className="card p-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ink-200)] bg-[var(--ink-50)] text-[var(--negative)]">
          <IconShield className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-900)]">
          Access paused
        </h1>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--ink-500)]">
          {access?.reason ??
            "Your access to this workspace is currently unavailable. Please contact your administrator."}
        </p>

        {access?.subscription && (
          <dl className="mt-5 space-y-1.5 border-t border-[var(--ink-100)] pt-4 text-[0.8125rem]">
            <div className="flex justify-between">
              <dt className="text-[var(--ink-500)]">Firm</dt>
              <dd className="font-medium text-[var(--ink-800)]">{access.firmName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--ink-500)]">Plan</dt>
              <dd className="font-medium text-[var(--ink-800)]">
                {access.subscription.plan.name}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--ink-500)]">Status</dt>
              <dd>
                <span className="badge badge-voided">
                  <span className="badge-dot" />
                  {access.subscription.status.replace(/_/g, " ")}
                </span>
              </dd>
            </div>
          </dl>
        )}

        <p className="mt-5 text-[0.75rem] text-[var(--ink-400)]">
          Your data is safe and unchanged. Access resumes as soon as the subscription is restored.
        </p>

        <form action={logout} className="mt-6">
          <button className="btn btn-secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
