"use client";

import { cn } from "@/lib/utils";

/**
 * A compact segmented control (Frenz Exclusive Part 6) — one track, a raised selected thumb, the
 * way iOS draws a small set of exclusive choices. A real radiogroup: each option is a radio with
 * its full name for assistive tech (the visible label may be shorter, e.g. "Both"). Colour is not
 * the only signal: the selected option is raised, bold and `aria-checked`. No animation library;
 * a colour/shadow transition that `motion-reduce` turns off.
 */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** the full name read to assistive tech, when the visible label is shortened */
  name?: string;
}

export function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T | null; options: readonly SegmentOption<T>[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-full bg-black/[0.05] p-1 ring-1 ring-inset ring-black/[0.04] dark:bg-white/[0.06] dark:ring-white/[0.06]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.name ?? o.label}
            disabled={disabled || value === null}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-10 min-w-0 truncate rounded-full px-1.5 text-[12.5px] transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none",
              on ? "bg-background font-bold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_12px_-6px_rgba(15,23,42,0.25)] dark:bg-white/[0.14] dark:shadow-none" : "font-semibold text-muted-foreground hover:text-foreground",
              value === null && "opacity-60",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type AlertMode = "off" | "push" | "email" | "both";
export const ALERT_OPTIONS: readonly SegmentOption<AlertMode>[] = [
  { value: "off", label: "Off" },
  { value: "push", label: "Push" },
  { value: "email", label: "Email" },
  { value: "both", label: "Both", name: "Push and email" },
];
