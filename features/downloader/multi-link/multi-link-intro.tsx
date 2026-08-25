"use client";

import { ChevronDown, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The explanatory section above the Multi-Link control (owner, 2026-08-25).
 *
 * ── Why the copy is worth its own component ───────────────────────────────
 * "＋ Multiple Links" alone does not say the one thing that makes the feature
 * worth opening: that the links can come from DIFFERENT platforms. Someone
 * with a TikTok and an Instagram link in their clipboard has no reason to
 * guess that, so the capability has to be stated before the control, not
 * discovered after it.
 *
 * ── What this deliberately does not do ────────────────────────────────────
 * It names no platforms. The supported set is already rendered — and kept
 * honest — by `SupportedPlatforms`, which reads the real registry; a second
 * hand-written list here would be the exact drift that keeps having to be
 * removed from this codebase, and would start overpromising the moment a
 * platform is added or (as with YouTube) removed.
 *
 * ── Weight ────────────────────────────────────────────────────────────────
 * Text, two icons and a border. No images, no animation library, no data
 * fetch. The plan comes from the caller, which already knows it — asking the
 * server here would put a request on every cold landing visit for a line of
 * copy.
 */
export function MultiLinkIntro({
  open,
  onToggle,
  sourceLimit,
  isPro,
  /** Free only: today's remaining allowance, shown separately so the
   *  description isn't crowded with two different numbers. */
  remainingToday,
  surface = "card",
}: {
  open: boolean;
  onToggle: () => void;
  sourceLimit: number;
  isPro: boolean;
  remainingToday?: number | null;
  surface?: "hero" | "card";
}) {
  const onHero = surface === "hero";

  /*
    🔴 THE DESCRIPTION IS HIDDEN BY DEFAULT (owner, 2026-08-25: "hide the
    multilink gray description, the H1 and the same platform, mixed platform
    and batch download text is enough, the gray description occupied a lot of
    space in hero section … show like a display mock when a learn more button
    near the H1 is clicked, and a hide button should show when it display and
    it should auto hide after 3secs, so it doesnt occupy space").

    ── Why it is an OVERLAY, not a collapsing block ────────────────────────
    "so it doesnt occupy space" is the requirement, and a block that expands
    in place occupies space by definition — it would also push the paste box
    and the whole hero down the moment it opened, which is a layout shift on
    the page whose CLS was measured at 0.684 once already. So it floats above
    the layout (`absolute`) and the section reserves nothing for it. Opening
    and closing move no other pixel.
  */
  const [showDetail, setShowDetail] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!showDetail) return;
    hideTimer.current = setTimeout(() => setShowDetail(false), 3000);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showDetail]);

  return (
    <section
      aria-labelledby="multi-link-heading"
      className={cn("mt-5", onHero ? "text-white" : "text-foreground")}
    >
      {/*
        Constrained width, centred (§3, §11). Prose that runs the full width of
        a desktop viewport is measurably harder to read, and the download card
        above it is already a bounded column — matching it keeps the section
        visually balanced around the tool rather than spanning past it.
      */}
      <div className="relative mx-auto max-w-xl text-center">
        <div className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
          <h3
            id="multi-link-heading"
            className={cn(
              // Prominent, not oversized — a step below the page's own H1.
              "text-balance text-lg font-extrabold tracking-tight sm:text-xl",
            )}
          >
            Download multiple links, all in one place.
          </h3>

          {/* Beside the heading, as asked. Doubles as the Hide control while
              the detail is up, so no second button appears and disappears. */}
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            aria-controls="multi-link-detail"
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              onHero ? "text-white/80 hover:text-white" : "text-primary",
            )}
          >
            {showDetail ? "Hide" : "Learn more"}
          </button>
        </div>

        {/*
          The detail card. `absolute` so it never displaces the paste box below
          it — the whole point of hiding it was the space it took in the hero.
          `aria-live` because it appears and self-dismisses without focus
          moving, which a screen reader would otherwise never learn about.
        */}
        {showDetail ? (
          <div
            id="multi-link-detail"
            role="status"
            aria-live="polite"
            onMouseEnter={() => {
              // Reading it shouldn't be a race against the timer.
              if (hideTimer.current) clearTimeout(hideTimer.current);
            }}
            onMouseLeave={() => setShowDetail(false)}
            className={cn(
              "animate-fade-up absolute left-1/2 top-full z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border p-3 text-left text-sm leading-relaxed shadow-luxury",
              onHero
                ? "border-white/15 bg-[#0b1020]/95 text-white/85 backdrop-blur"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            Add links from the same platform or mix different supported platforms into one batch.
            Fetch, choose what you want, and download everything together.
          </div>
        ) : null}

        {/* Capability chips — subtle, thin, monochrome. Wrap on mobile. */}
        <ul className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {["Same platform", "Mixed platforms", "Batch download"].map((chip) => (
            <li
              key={chip}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                onHero
                  ? "border-white/20 bg-white/[0.07] text-white/85"
                  : "border-border/70 bg-secondary/40 text-muted-foreground",
              )}
            >
              {chip}
            </li>
          ))}
        </ul>
      </div>

      {/*
        The collapsed card IS the button (§5) — the whole surface is tappable,
        not just the words. On a phone that is the difference between a control
        you can hit and one you aim at.
      */}
      <div className="mx-auto mt-3.5 max-w-xl">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="multi-link-panel"
          className={cn(
            "group flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            onHero
              ? "border-white/20 bg-white/[0.07] hover:bg-white/[0.12]"
              : "border-border bg-card shadow-soft hover:border-primary/40 hover:bg-secondary/40",
            open && (onHero ? "border-white/35 bg-white/[0.12]" : "border-primary/50 bg-secondary/40"),
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              onHero ? "bg-white/10 text-white" : "bg-secondary text-foreground",
            )}
          >
            <Layers aria-hidden className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">
              <span aria-hidden>＋</span> Multiple Links
            </span>
            <span
              className={cn(
                "mt-0.5 block text-xs",
                onHero ? "text-white/70" : "text-muted-foreground",
              )}
            >
              {/*
                §12 — Free is told what it HAS, never what it lacks. "Add up to
                3 sources" and "Add up to 6 sources · PRO" are the same
                sentence shape; nothing here frames the free tier as a
                restriction.
              */}
              Add up to {sourceLimit} sources
              {isPro ? " · PRO" : ""}
            </span>
          </span>

          {/* §9 — the chevron rotates. `transform` only, so it is composited. */}
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
              onHero ? "text-white/70" : "text-muted-foreground",
              open && "rotate-180",
            )}
          />
        </button>

        {/*
          The daily allowance, kept OUT of the description above (§2) — two
          different numbers in one paragraph ("up to 3 links", "2 downloads
          left") read as one confusing rule rather than two clear ones.
        */}
        {!isPro && typeof remainingToday === "number" ? (
          <p
            className={cn(
              "mt-1.5 px-1 text-center text-[11px]",
              onHero ? "text-white/65" : "text-muted-foreground",
            )}
          >
            {remainingToday > 0 ? (
              <>
                <span className="font-semibold">{remainingToday}</span> batch{" "}
                {remainingToday === 1 ? "download" : "downloads"} remaining today
              </>
            ) : (
              "Daily batch limit reached"
            )}
          </p>
        ) : null}
        {isPro ? (
          <p
            className={cn(
              "mt-1.5 px-1 text-center text-[11px]",
              onHero ? "text-white/65" : "text-muted-foreground",
            )}
          >
            Unlimited batches with Pro
          </p>
        ) : null}
      </div>
    </section>
  );
}
