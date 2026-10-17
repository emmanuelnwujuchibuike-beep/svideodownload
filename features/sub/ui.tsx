import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The Frenz Exclusive surface tokens — the `.ex-*` glass vocabulary in app/globals.css, named for
 * the components that use it.
 *
 * Owner directive 2026-10-16 ("native iOS glass … throughout Frenz Exclusive"): the Exclusive
 * screens had kept the Friends tokens (`GLASS` = a 24px `backdrop-blur-xl` on every card), so the
 * setup, feed, favourites, subscriptions and membership screens looked unchanged and blurred far
 * past the 8px budget. Every Exclusive screen takes its surfaces from here instead, so the look is
 * one decision. A card never blurs (`.ex-card`); only the few floating surfaces do (`.ex-glass`).
 */
export const EX_CARD = "ex-card";
export const EX_GLASS = "ex-glass";
export const exPrimary = "ex-btn ex-btn--primary";
export const exGlassBtn = "ex-btn ex-btn--glass";
export const exQuiet = "ex-btn ex-btn--quiet";
export const exDanger = "ex-btn ex-btn--danger";
/** A text input on a glass card: inset fill, hairline, a soft focus ring. 16px text, so iOS never zooms. */
export const exField = "ex-field";

/** A list of rows in one card, hairline-divided — never a card per row. */
export function ExGroup({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "ex-card ex-rows overflow-hidden rounded-[22px]",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** A quiet inset group INSIDE a card (a note, a preview, a breakdown) — a well, never a nested card. */
export const EX_WELL = "rounded-2xl bg-black/[0.03] dark:bg-white/[0.045]";
/** A near-solid sheet that rises from the bottom edge (square bottom corners on phones). */
export const EX_SHEET = "ex-card ex-sheet";
/** A compact select / admin input: the field's look, sized by its own utilities. */
export const exCompactField =
  "min-h-[2.25rem] rounded-full border border-black/[0.08] bg-white/70 px-3 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:border-white/10 dark:bg-white/[0.06]";
