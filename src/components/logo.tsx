/** Brand mark: an "L" ledger column with a debit/credit bar — emerald on ink. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="var(--ink-900)" />
      <path d="M10 8h3v13h9v3H10V8z" fill="var(--brand-500)" />
      <path d="M19 8h3v8h-3z" fill="#E8ECF1" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span
        className="text-[0.9375rem] font-semibold tracking-tight"
        style={{ color: dark ? "#fff" : "var(--ink-900)" }}
      >
        Ledger
      </span>
    </span>
  );
}
