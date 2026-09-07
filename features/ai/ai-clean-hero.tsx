import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The stage — the single large surface AI Clean's whole flow happens inside.
 *
 * ── Why one surface and not four cards ────────────────────────────────────────
 * Empty, link entry, preview, error and the ready state are five moments in ONE
 * task. Giving each its own card would make the page look like a dashboard of
 * unrelated widgets and would make every transition a layout jump. Instead the
 * frame stays put and only its contents change, which is what makes the
 * transitions feel like a native app rather than a page reload.
 *
 * ── The wash ──────────────────────────────────────────────────────────────────
 * One very low-opacity brand ellipse behind the top edge. It is `aria-hidden`,
 * static (no drift, no pulse — the battery rule), and sits under a plain card
 * background so text contrast is never measured against a gradient. Deliberately
 * far short of a "huge gradient": at this opacity it reads as light in the room,
 * not as colour on the page.
 */
export function AICleanHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-64 w-[140%] -translate-x-1/2 rounded-[50%] bg-brand opacity-[0.06] blur-3xl dark:opacity-[0.12]"
      />
      {children}
    </section>
  );
}
