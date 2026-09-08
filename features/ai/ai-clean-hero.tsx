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
export function AICleanHero({
  children,
  className,
  bare = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Drop the frame and the wash, keeping only the positioning context.
   *
   * 🔴 For the INPUT screen (owner, 2026-09-08). `public/ai input page.jpg`
   * lays that page directly on the page ground — no card, no border — because
   * it already contains several cards of its own, and a card of cards reads as
   * a dashboard rather than as one task.
   *
   * Every other state keeps the frame, which is what makes choosing, watching
   * and downloading feel like one surface the work happens inside.
   */
  bare?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden",
        bare ? "rounded-none" : "rounded-3xl border border-border/70 bg-card shadow-card",
        className,
      )}
    >
      {/*
        The wash now BREATHES WITH THE JOB (2026-09-07). Its opacity is derived
        from `--ai-intensity`, which FrenzAIEnvironment sets from the job's
        state — so the surface itself brightens as the work moves from queued to
        finalizing and settles again afterwards.

        The fallback keeps it exactly as it was for any surface rendered without
        an environment above it, and the multiplier holds it well under the
        text: this is light behind a card, never a tint the copy is read against.
      */}
      {bare ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-64 w-[140%] -translate-x-1/2 rounded-[50%] bg-brand blur-3xl"
          style={{ opacity: "calc(var(--ai-intensity, 0.22) * 0.28)" }}
        />
      )}
      {children}
    </section>
  );
}
