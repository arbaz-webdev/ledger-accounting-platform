"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh server data periodically while this portal tab is visible. */
export function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);
  return null;
}
