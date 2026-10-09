"use client";

import { ChevronDown, Download } from "lucide-react";

import { ProBadge } from "@/features/monetization/pro-badge";
import { cn } from "@/lib/utils";

/**
 * The Multi-Link card above the batch panel — ONE tappable row, rebuilt to the
 * improved reference (Download page refinement, 2026-10-09: "Multiple links —
 * clearer explanation, shows Pro requirement, less confusion").
 *
 *   [⤓]  Download multiple links                 [Up to 6]  ⌄
 *        Add up to N links and process them together.   [PRO]
 *
 * ── What changed, and why ─────────────────────────────────────────────────
 * It used to be two blocks: a "Save multiple links" heading with a "?" that
 * floated the explanation for three seconds, and under it a "＋ Multiple Links"
 * row. The explanation was the thing people needed and it was hidden behind a
 * timer. Now the sentence IS the row's subtitle, so there is nothing to open
 * and nothing to time out, and the card is one row shorter.
 *
 * ── The Pro requirement, stated rather than implied ───────────────────────
 * The subtitle counts the visitor's OWN limit (`sourceLimit`: 3 on Free, 6 on
 * Pro by default — admin-configurable, server-threaded). The pill counts the
 * PRO limit and carries the PRO badge whenever Pro allows more than Free, so a
 * free member reads "I can add 3; Pro adds up to 6" at a glance. Nothing here
 * decides access: the panel and the server still enforce the real limit.
 *
 * ── Still free to draw ────────────────────────────────────────────────────
 * No fetch, no timer, no animation at rest — text, two icons and a boolean.
 * The daily allowance stays in the opened panel (`PlanStrip`), so the closed
 * card needs no per-visitor data (see multi-link-button.tsx).
 */

export function MultiLinkIntro({
  open,
  onToggle,
  sourceLimit,
  proLimit,
  isPro,
  surface = "card",
}: {
  open: boolean;
  onToggle: () => void;
  /** What THIS visitor can add. */
  sourceLimit: number;
  /** What the Pro plan allows — the number the pill shows. */
  proLimit: number;
  isPro: boolean;
  surface?: "hero" | "card";
}) {
  const onHero = surface === "hero";
  // The badge says "this needs Pro" only when Pro actually unlocks more — or,
  // for a Pro member, that this is their plan's allowance.
  const showPro = isPro || proLimit > sourceLimit;
  const limitPill = (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-bold leading-tight",
        onHero ? "bg-white/15 text-white" : "bg-primary/10 text-primary",
      )}
    >
      Up to {showPro ? proLimit : sourceLimit}
    </span>
  );

  return (
    <section aria-label="Download multiple links" className="mt-4">
      {/* The whole row is the button — on a phone that is the difference between
          a control you can hit and one you aim at. 36 px tile + 24 px padding
          keeps it over the 44 px floor. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="multi-link-panel"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-left transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          onHero
            ? "bg-white/[0.07] ring-1 ring-inset ring-white/20 hover:bg-white/[0.12]"
            : "bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-inset ring-slate-200/90 hover:ring-primary/40 dark:bg-white/[0.04] dark:ring-white/10",
          open && (onHero ? "bg-white/[0.12] ring-white/35" : "ring-primary/50"),
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            onHero ? "bg-white/10 text-white" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
          )}
        >
          <Download aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </span>

        <span className="min-w-0 flex-1">
          <span className={cn("block text-[14px] font-bold leading-tight tracking-[-0.01em]", onHero ? "text-white" : "text-slate-900 dark:text-white")}>
            Download multiple links
          </span>
          <span className={cn("mt-1 block text-xs leading-snug", onHero ? "text-white/70" : "text-muted-foreground")}>
            Add up to {sourceLimit} links and process them together.
          </span>
          <span className="mt-1.5 flex items-center gap-1.5 min-[360px]:hidden" aria-hidden>
            {limitPill}
            {showPro ? <ProBadge /> : null}
          </span>
          {showPro ? <span className="sr-only">Pro plan: up to {proLimit} links</span> : null}
        </span>

        {/* The limit pill over the PRO badge, as in the reference. Below 360 px
            the same pair moves under the subtitle (below) so the title keeps
            its width instead of wrapping word by word. */}
        <span className="hidden shrink-0 flex-col items-end gap-1 min-[360px]:flex" title={showPro ? `Pro plan: up to ${proLimit} links` : undefined}>
          {limitPill}
          {showPro ? <ProBadge /> : null}
        </span>

        {/* Rotates on `transform` only, so it is composited. */}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            onHero ? "text-white/70" : "text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>
    </section>
  );
}
