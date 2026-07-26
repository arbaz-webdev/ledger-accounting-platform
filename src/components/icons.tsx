/**
 * Minimal outline icon set (Heroicons-style, 24 viewBox, 1.5 stroke).
 * SVG only — no emoji icons anywhere in the product.
 */

type IconProps = { className?: string };

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: props.className ?? "h-[1.125rem] w-[1.125rem]",
    "aria-hidden": true,
  };
}

export function IconOverview(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconBook(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5.5C10.5 4.2 8.4 3.5 5.5 3.5c-.6 0-1 .4-1 1v13c0 .6.4 1 1 1 2.9 0 5 .7 6.5 2 1.5-1.3 3.6-2 6.5-2 .6 0 1-.4 1-1v-13c0-.6-.4-1-1-1-2.9 0-5 .7-6.5 2z" />
      <path d="M12 5.5v15" />
    </svg>
  );
}

export function IconJournal(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 4.5h14a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
    </svg>
  );
}

export function IconScale(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5v17M7 20.5h10" />
      <path d="M5.5 6.5h13" />
      <path d="M5.5 6.5 3 12.5a3 3 0 0 0 5 0l-2.5-6zM18.5 6.5 16 12.5a3 3 0 0 0 5 0l-2.5-6z" />
    </svg>
  );
}

export function IconRows(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 6.5h16M4 10.5h16M4 14.5h16M4 18.5h10" />
    </svg>
  );
}

export function IconTrend(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3.5 17.5 9 12l3.5 3.5L20.5 7" />
      <path d="M15.5 7h5v5" />
    </svg>
  );
}

export function IconBank(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m3.5 9 8.5-5 8.5 5v1.5h-17V9z" />
      <path d="M5.5 10.5v6M9.8 10.5v6M14.2 10.5v6M18.5 10.5v6M4 19.5h16" />
    </svg>
  );
}

export function IconCash(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 9.5h.01M17.5 14.5h.01" />
    </svg>
  );
}

export function IconCalendar(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="5.5" width="16" height="14" rx="1.5" />
      <path d="M4 9.5h16M8.5 3.5v3M15.5 3.5v3" />
    </svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5 5 6v5.2c0 4.3 2.9 7.5 7 9.3 4.1-1.8 7-5 7-9.3V6l-7-2.5z" />
      <path d="m9 11.8 2.1 2.1L15.3 9.7" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4.5 12h15M13.5 6l6 6-6 6" />
    </svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />
    </svg>
  );
}

export function IconPrint(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.75 8.25V3.75h10.5v4.5M6.75 17.25H5.25A1.5 1.5 0 0 1 3.75 15.75v-4.5a1.5 1.5 0 0 1 1.5-1.5h13.5a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-1.5M6.75 14.25h10.5v6H6.75z" />
    </svg>
  );
}

export function IconLock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="10.5" width="14" height="9" rx="1.5" />
      <path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" />
    </svg>
  );
}

export function IconUnlock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="10.5" width="14" height="9" rx="1.5" />
      <path d="M8 10.5V8a4 4 0 0 1 7.8-1.2" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 4 2.8 19.5h18.4L12 4z" />
      <path d="M12 10v4.2M12 16.8h.01" />
    </svg>
  );
}

export function IconBuilding(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 20.5V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15.5" />
      <path d="M15 9.5h3a1 1 0 0 1 1 1v10M3.5 20.5h17" />
      <path d="M8 7.5h2M8 11h2M8 14.5h2M12 7.5h.5M12 11h.5M12 14.5h.5" />
    </svg>
  );
}

export function IconSignOut(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14 4.5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h8" />
      <path d="M10.5 12h9M16.5 8.5 20 12l-3.5 3.5" />
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}
