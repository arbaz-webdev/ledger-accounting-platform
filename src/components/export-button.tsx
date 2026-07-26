import { IconDownload } from "@/components/icons";

/**
 * CSV download link for a report. Renders as a normal link (no JS needed) and
 * is hidden when printing.
 */
export function ExportButton({
  entityId,
  report,
  params,
  label = "Export CSV",
}: {
  entityId: string;
  report: string;
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v) query.set(k, v);
  }
  const qs = query.toString();

  return (
    <a
      href={`/accountant/${entityId}/export/${report}${qs ? `?${qs}` : ""}`}
      className="btn btn-secondary no-print"
      download
    >
      <IconDownload className="h-4 w-4" />
      {label}
    </a>
  );
}

export { PrintButton } from "./print-button";
