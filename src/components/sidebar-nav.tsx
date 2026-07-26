"use client";

import { usePathname } from "next/navigation";
import {
  IconOverview,
  IconBook,
  IconJournal,
  IconScale,
  IconRows,
  IconTrend,
  IconBank,
  IconCash,
  IconCalendar,
  IconShield,
  IconBuilding,
  IconSettings,
} from "@/components/icons";

const ICONS: Record<string, (p: { className?: string }) => React.ReactNode> = {
  overview: IconOverview,
  book: IconBook,
  journal: IconJournal,
  scale: IconScale,
  rows: IconRows,
  trend: IconTrend,
  bank: IconBank,
  cash: IconCash,
  calendar: IconCalendar,
  shield: IconShield,
  building: IconBuilding,
  settings: IconSettings,
};

export type NavItem =
  | { href: string; label: string; icon: keyof typeof ICONS; module?: string }
  | { section: string; module?: string };

export function SidebarNav({ entityId, items }: { entityId: string; items: NavItem[] }) {
  const pathname = usePathname();
  const basePath = `/accountant/${entityId}`;

  return (
    <nav className="space-y-0.5 px-3 pb-4">
      {items.map((item, i) => {
        if ("section" in item) {
          return (
            <div key={i} className="side-section">
              {item.section}
            </div>
          );
        }
        const href = `${basePath}${item.href}`;
        const active = item.href === "" ? pathname === basePath : pathname.startsWith(href);
        const Icon = ICONS[item.icon];
        return (
          <a key={i} href={href} className={`side-link ${active ? "side-link-active" : ""}`}>
            <Icon className="h-[1.0625rem] w-[1.0625rem]" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
