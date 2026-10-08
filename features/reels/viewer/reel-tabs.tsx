"use client";

import { motion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { GLYPH_SHADOW, layer, reelMotion } from "./design";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE VIEWER'S TOP NAVIGATION (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "For You, Following, Friends, Communities, Nearby (optional). Everything
 *  should smoothly animate. The selected tab should use a premium underline
 *  animation. The navigation should automatically adapt to long translations in
 *  other languages."
 *
 * ── DECLARED in full, RENDERED only where there is a real feed ──────────────
 *
 * All five are declared below. Only the ones with a working data source are
 * rendered, and availability is DERIVED from what the caller passes rather than
 * hardcoded here — the same "declare everything, derive availability, fail
 * closed" shape the Download Hub uses.
 *
 * Today that means For You and Following. Friends, Communities and Nearby are
 * declared and dark, because `/api/reels` has no query behind them yet. Shipping
 * a tab that opens an empty deck is worse than not shipping the tab: it reads as
 * a broken feature rather than an unbuilt one, and this project has a standing
 * rule against surfacing affordances with no real target.
 *
 * The moment a feed exists, it appears here by adding one id to `available` —
 * no new markup, no second nav to keep in sync.
 *
 * ── Adapting to long translations, concretely ──────────────────────────────
 *
 * "For You" is 7 characters; German "Für dich" is 8, and Communities becomes
 * "Gemeinschaften" at 14. Five tabs at that length do not fit a 320px phone, so
 * the row would either wrap (breaking the underline's geometry) or overflow
 * invisibly.
 *
 * Three things handle it, and none is a media query:
 *  • The row is a scroll container with the active tab kept in view, so the set
 *    can be any width in any language.
 *  • The label is `whitespace-nowrap` — a tab that wraps mid-word is unreadable
 *    and destroys the underline alignment.
 *  • The underline is a `layoutId` element, so it measures whatever the label
 *    actually is. Nothing here assumes a width, which is what makes it survive a
 *    language nobody tested.
 *
 * 🔴 Unlike the strip on the landing page, a scroll container is CORRECT here:
 * its children are real buttons, so it is keyboard-reachable by construction and
 * does not trip `scrollable-region-focusable` the way a strip of inert spans did.
 *
 * ── Why the underline is `layoutId` and not a transform ────────────────────
 *
 * framer's shared-layout animation measures both positions and interpolates, so
 * the indicator travels between tabs of DIFFERENT widths correctly. A hand-rolled
 * `translateX` needs the widths up front — which is exactly the assumption that
 * breaks the moment a translation changes them.
 */

export type ReelTabId = "for_you" | "following" | "ai" | "friends" | "communities" | "nearby";

/**
 * Every tab the viewer will ever have, in display order.
 *
 * `label` stays literal for now: this component sits inside the reels deck,
 * which is not yet part of the i18n catalogue. When it is, these become message
 * keys and the layout above is already built for the result.
 */
export const REEL_TABS: { id: ReelTabId; label: string }[] = [
  { id: "for_you", label: "For You" },
  { id: "following", label: "Following" },
  // 2026-10-07 (owner): AI Reels — Frenz AI videos only (/api/reels?content=ai), a tab of the same deck, not a second product
  { id: "ai", label: "AI Reels" },
  { id: "friends", label: "Friends" },
  { id: "communities", label: "Communities" },
  { id: "nearby", label: "Nearby" },
];

export function ReelTabs({
  active,
  onChange,
  /**
   * Which tabs have a real feed behind them. Anything not listed is not
   * rendered — see the note above on why a dark tab beats an empty deck.
   */
  available,
  className,
  /**
   * A real navigation OUT of Reels entirely, into the Feed product — not
   * another reel-content tab (owner, 2026-08-18: "restyle this for you and
   * following tray to also include a feed button... users who haven't
   * signed in can click on it from the landing page and enter feed").
   * Rendered as a `<Link>`, not an `onChange` call: tapping it leaves this
   * deck rather than swapping which reels play in place. Kept visually
   * distinct from the tabs (its own icon, a hairline divider before it)
   * precisely so it doesn't read as a sixth interchangeable reel feed.
   */
  feedHref,
}: {
  active: ReelTabId;
  onChange: (id: ReelTabId) => void;
  available: readonly ReelTabId[];
  className?: string;
  feedHref?: string;
}) {
  const tabs = REEL_TABS.filter((t) => available.includes(t.id));
  const rowRef = useRef<HTMLDivElement>(null);
  /*
    Which edges have more tabs beyond them — drives the soft edge fade, so an
    overflowing row reads as "scroll for more" instead of being cut off (or,
    as it was, running under the Close and ••• buttons). Measured on scroll
    and resize only; no timer, no per-frame work.
  */
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft > 2, end: max - el.scrollLeft > 2 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);
  // the active tab is always the one in view
  useEffect(() => {
    rowRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);
  // A single destination is not a choice — rendering one tab is chrome that
  // teaches nothing and still costs the safe-area strip it sits in. The Feed
  // link (when present) still renders on its own below, since it isn't a
  // reel-content tab and the "not a real choice" reasoning doesn't apply to it.
  if (tabs.length < 2 && !feedHref) return null;

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label="Reels feeds"
      data-edge-start={edges.start || undefined}
      data-edge-end={edges.end || undefined}
      className={cn(
        /*
          🔴 FITTED BETWEEN THE CORNER BUTTONS (owner, 2026-10-08: "this reels
          tray are over flowing to X button and on smaller device is worst").

          Close and ••• are 2.5rem circles 1rem in from each edge
          (reel-viewer.tsx), so 4rem on each side is theirs: the row may use
          `100vw - 8rem`, never more. It shares their top and their height
          (h-10), so the three read as ONE bar, centred on the same line. What
          does not fit scrolls, with a soft fade at the edge that has more — the
          mask is only applied to an edge that actually overflows.
        */
        "fixed left-1/2 top-[max(1rem,var(--frenz-safe-top))] flex h-10 max-w-[min(calc(100vw-8rem),26rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto scroll-px-2 px-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "data-[edge-end]:[mask-image:linear-gradient(to_right,#000_calc(100%-1.75rem),transparent)]",
        "data-[edge-start]:[mask-image:linear-gradient(to_right,transparent,#000_1.75rem)]",
        "data-[edge-start]:data-[edge-end]:[mask-image:linear-gradient(to_right,transparent,#000_1.75rem,#000_calc(100%-1.75rem),transparent)]",
        /*
          🔴 NO GLASS PANEL BEHIND THIS ROW (owner, 2026-08-25: "i want the glass
          background of the reels top nav to be removed, the black glass
          background").

          It used to carry `glass.secondary` — a `bg-black/25` tint plus a blur —
          added because bare white text over video is legible on some frames and
          invisible on others. That argument was right about the RISK and wrong
          about the remedy: a dark slab pinned across the top of every reel is
          the one piece of chrome that is always on screen, so it is also the one
          that most persistently contradicts "the video is the hero".

          The contrast floor is still guaranteed, by the two mechanisms that
          already existed and cost no extra surface:
           • the deck's ADAPTIVE top scrim (`scrimForLuminance`, reel-viewer)
             sits under this row and darkens with the actual frame luminance —
             it does more than a fixed tint ever did, and it fades with the rest
             of the chrome instead of persisting;
           • `GLYPH_SHADOW` on each label (below), the same treatment every other
             glyph that legitimately sits directly on video already uses.

          So the blur is gone, not the legibility. Do not reintroduce a tint here
          without removing one of those two — two floors stacked is what made
          this read as a slab in the first place.
        */
        layer.topNav,
        className,
      )}
    >
      {tabs.length >= 2 ? tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative shrink-0 rounded-full px-2.5 py-1.5 outline-none transition active:scale-95 min-[380px]:px-3",
              "focus-visible:ring-2 focus-visible:ring-white/80",
            )}
          >
            <span
              className={cn(
                "relative z-[1] whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em] transition-colors",
                // Sits directly on video now that the panel is gone — same
                // shadow as every other on-video glyph, so an inactive label
                // never dissolves into a bright frame.
                GLYPH_SHADOW,
                on ? "text-white" : "text-white/70 hover:text-white/90",
              )}
            >
              {t.label}
            </span>
            {/*
              The premium indicator: a filled glass PILL that travels, with a
              hairline underline riding under the label.

              A pill rather than only an underline because at this size an
              underline alone is a 3px cue on top of moving video — it is the
              first thing to get lost on a busy frame. The pill gives the active
              tab its own surface; the underline keeps the familiar affordance.
            */}
            {on ? (
              <>
                <motion.span
                  layoutId="reel-tab-pill"
                  transition={reelMotion.chrome}
                  className="absolute inset-0 rounded-full bg-white/20 ring-1 ring-inset ring-white/25"
                />
                <motion.span
                  layoutId="reel-tab-underline"
                  transition={reelMotion.chrome}
                  className="absolute inset-x-3 -bottom-0.5 h-[2px] rounded-full bg-[hsl(var(--reel-accent,0_0%_100%))]"
                />
              </>
            ) : null}
          </button>
        );
      }) : null}

      {feedHref ? (
        <>
          {/* white/35, not white/20: with no panel under it a hairline at 20%
              is invisible on a light frame, and this divider is the only thing
              telling the eye that Feed is not a sixth reel tab. */}
          {tabs.length >= 2 ? <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-white/35" /> : null}
          <Link
            href={feedHref}
            className={cn(
              // under 380px the word steps aside for its grid icon (still named for screen readers)
              "relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-semibold text-white/70 outline-none transition hover:text-white/90 active:scale-95 min-[380px]:px-3",
              "focus-visible:ring-2 focus-visible:ring-white/80",
              GLYPH_SHADOW,
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            <span className="max-[379px]:sr-only">Feed</span>
          </Link>
        </>
      ) : null}
    </div>
  );
}
