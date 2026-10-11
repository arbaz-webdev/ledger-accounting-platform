"use client";

import { useEffect } from "react";

/** Adds persistent, keyboard-accessible column handles to data tables. */
export function ResizableTables() {
  useEffect(() => {
    function install() {
      const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"));
      tables.forEach((table, tableIndex) => {
        if (table.dataset.resizeReady) return;
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child th"));
        if (headers.length < 2 || headers.some(th => th.colSpan > 1)) return;
        table.dataset.resizeReady = "1";
        const key = `ledger:columns:${location.pathname}:${tableIndex}`;
        const saved = (() => { try { return JSON.parse(localStorage.getItem(key) ?? "null") as number[] | null; } catch { return null; } })();
        let columns: HTMLTableColElement[] = [];
        function apply(widths: number[]) {
          if (!columns.length) {
            const group = document.createElement("colgroup");
            columns = headers.map(() => { const col = document.createElement("col"); group.append(col); return col; });
            table.prepend(group);
          }
          widths.forEach((width, i) => { columns[i].style.width = `${width}px`; });
          table.style.tableLayout = "fixed";
          table.style.minWidth = `${widths.reduce((sum, width) => sum + width, 0)}px`;
          try { localStorage.setItem(key, JSON.stringify(widths)); } catch { /* Storage can be disabled. */ }
        }
        if (saved?.length === headers.length && saved.every(width => Number.isFinite(width) && width >= 56 && width <= 2000)) apply(saved);
        headers.forEach((th, index) => {
          th.style.position = "relative";
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "column-resize-handle no-print";
          handle.setAttribute("aria-label", `Resize ${th.textContent?.trim() || `column ${index + 1}`} column`);
          handle.title = "Drag or use arrow keys to resize column";
          const widths = () => columns.length ? columns.map(col => parseFloat(col.style.width)) : headers.map(header => Math.max(56, Math.round(header.getBoundingClientRect().width)));
          handle.addEventListener("pointerdown", event => {
            event.preventDefault();
            const initial = widths();
            const start = event.clientX;
            handle.setPointerCapture(event.pointerId);
            const move = (next: PointerEvent) => { const resized = [...initial]; resized[index] = Math.max(56, Math.min(2000, Math.round(initial[index] + next.clientX - start))); apply(resized); };
            const stop = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", stop); handle.removeEventListener("pointercancel", stop); };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", stop);
            handle.addEventListener("pointercancel", stop);
          });
          handle.addEventListener("keydown", event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const resized = widths();
            resized[index] = Math.max(56, Math.min(2000, resized[index] + (event.key === "ArrowRight" ? 20 : -20)));
            apply(resized);
          });
          th.append(handle);
        });
      });
    }
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
