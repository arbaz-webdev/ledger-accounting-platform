import { fmtMoney, isNegative } from "@/lib/format";

/** Page header with title, subtitle and right-aligned actions. */
export function PageHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="flex items-end gap-2">{children}</div>}
    </div>
  );
}

/** Money amount with tabular numerals; negatives shown as (…) in red. */
export function Amount({ value, strong }: { value: string | number; strong?: boolean }) {
  const neg = isNegative(value);
  return (
    <span className={`num ${neg ? "amount-neg" : ""} ${strong ? "font-semibold" : ""}`}>
      {fmtMoney(value)}
    </span>
  );
}

const JE_BADGES: Record<string, { cls: string; label: string }> = {
  draft: { cls: "badge-draft", label: "Draft" },
  pending_approval: { cls: "badge-pending", label: "Pending approval" },
  posted: { cls: "badge-posted", label: "Posted" },
  voided: { cls: "badge-voided", label: "Voided" },
};

export function StatusBadge({ status }: { status: string }) {
  const b = JE_BADGES[status] ?? { cls: "badge-neutral", label: status };
  return (
    <span className={`badge ${b.cls}`}>
      <span className="badge-dot" />
      {b.label}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "brand" | "negative";
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-[var(--ink-500)]">{label}</div>
      <div
        className={`num mt-1.5 text-xl font-semibold tracking-tight ${
          accent === "brand"
            ? "text-[var(--brand-700)]"
            : accent === "negative"
              ? "text-[var(--negative)]"
              : "text-[var(--ink-900)]"
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-[var(--ink-400)]">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ink-200)] bg-[var(--ink-50)] text-[var(--ink-400)]">
        {icon}
      </div>
      <div className="text-sm font-semibold text-[var(--ink-800)]">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[0.8125rem] text-[var(--ink-500)]">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
