"use client";

import { cn } from "@/lib/utils";

/**
 * The Exclusive segmented control — a glass track with ONE thumb that slides under the selected
 * option (`.ex-seg`, app/globals.css), the way iOS draws a small set of exclusive choices.
 *
 * A real radiogroup: each option is a radio with its full name for assistive tech (the visible
 * label may be shorter, e.g. "Both"). The selected option is also bold and `aria-checked`, so
 * colour is never the only signal. The thumb moves with a single `transform` transition (no
 * layout, no filter), which reduced motion switches off; nothing runs while idle.
 */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** the full name read to assistive tech, when the visible label is shortened */
  name?: string;
}

export function Segmented<T extends string>({ value, options, onChange, label, disabled, className }: { value: T | null; options: readonly SegmentOption<T>[]; onChange: (v: T) => void; label: string; disabled?: boolean; className?: string }) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div role="radiogroup" aria-label={label} className={cn("ex-seg ex-glass", value === null && "opacity-60", className)}>
      {index >= 0 ? <span aria-hidden className="ex-seg__thumb" style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }} /> : null}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.name ?? o.label} disabled={disabled || value === null} onClick={() => onChange(o.value)} className="ex-seg__opt">
          {o.label}
        </button>
      ))}
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
