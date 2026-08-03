"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared form primitives for the Universal Profile Engine's editors
 * (Feature 18 · Part 14). Three screens edit different halves of the same
 * platform; sharing the field chrome is what stops them drifting into three
 * slightly different-looking forms.
 */

export const INPUT =
  "h-10 w-full rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";

export const TEXTAREA =
  "min-h-[96px] w-full rounded-xl bg-background p-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function SaveMessage({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role="status" className={cn("mt-3 text-sm font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>
      {msg.text}
    </p>
  );
}

/**
 * A comma-separated list input (skills, languages). Chosen over a tag widget
 * because a comma is something every keyboard, every screen reader and every
 * paste from a CV already understands.
 */
export function ListInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <input
      className={INPUT}
      defaultValue={value.join(", ")}
      placeholder={placeholder}
      onBlur={(e) =>
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 30),
        )
      }
    />
  );
}
