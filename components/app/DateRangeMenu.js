"use client";

// Header date-range control shared by dashboard views: a compact trigger that
// opens a panel with quick presets and a custom From/To range.
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { DateField } from "@/components/ui/date-field";

const seg = (on) =>
  on
    ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]"
    : "bg-transparent text-[#6b6b76]";

/**
 * @param from / to      "YYYY-MM-DD" keys of the current range
 * @param max            latest selectable day
 * @param label          trigger text, e.g. "30 Sept – 9 Oct 2026"
 * @param summary        right-hand note in the panel header, e.g. "8 workdays"
 * @param presets        [{ key, label, active }] quick-select buttons
 * @param onPreset(key)  apply a preset
 * @param onFrom / onTo  set one end of a custom range
 */
export default function DateRangeMenu({ from, to, max, label, summary, presets = [], onPreset, onFrom, onTo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    // Clicks inside the date pickers' portalled calendars count as inside.
    const onDown = (event) => {
      const target = event.target;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]")) return;
      setOpen(false);
    };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-[9px] border bg-white px-3 py-[7px] text-[12.5px] text-[#17171c] ${open ? "border-[#17171c]" : "border-[#e0dfdb]"}`}
      >
        <CalendarDays className="h-3.5 w-3.5 text-[#6b6b76]" />
        {label}
        <ChevronDown className={`h-3.5 w-3.5 text-[#6b6b76] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-xl border border-[#e8e7e3] bg-white shadow-[0_12px_32px_rgba(0,0,0,.12)]">
          <div className="flex items-baseline justify-between border-b border-[#efeeea] px-4 py-3">
            <span className="text-[13px] font-semibold text-[#17171c]">Date range</span>
            {summary && <span className="text-[11.5px] text-[#6b6b76]">{summary}</span>}
          </div>
          {presets.length > 0 && (
            <div className="flex flex-col gap-2 px-4 pt-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[#8a8a93]">Quick select</span>
              <div className="grid gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(presets.length, 2)}, minmax(0,1fr))` }}>
                {presets.map((p) => (
                  <button key={p.key} onClick={() => onPreset?.(p.key)} className={`rounded-[7px] px-2 py-1.5 text-[12.5px] font-medium ${seg(p.active)}`}>{p.label}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#8a8a93]">Custom range</span>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex min-w-0 flex-col gap-1 text-[11.5px] text-[#55555e]">
                From
                <DateField value={from} max={to} onChange={(v) => v && onFrom?.(v)} align="start" aria-label="From date" className="h-9 w-full min-w-0 rounded-lg px-2.5 text-[12.5px]" />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[11.5px] text-[#55555e]">
                To
                <DateField value={to} min={from} max={max} onChange={(v) => v && onTo?.(v)} align="end" aria-label="To date" className="h-9 w-full min-w-0 rounded-lg px-2.5 text-[12.5px]" />
              </label>
            </div>
          </div>
          <div className="flex justify-end border-t border-[#efeeea] bg-[#fafaf8] px-4 py-2.5">
            <button onClick={() => setOpen(false)} className="rounded-lg bg-[#17171c] px-3.5 py-1.5 text-[12.5px] font-medium text-white">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
