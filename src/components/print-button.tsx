"use client";

import { IconPrint } from "@/components/icons";

/** Opens the browser print dialog. Statements carry print styles (globals.css). */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-secondary no-print">
      <IconPrint className="h-4 w-4" />
      {label}
    </button>
  );
}
