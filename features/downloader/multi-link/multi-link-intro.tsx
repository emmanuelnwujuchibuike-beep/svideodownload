"use client";

import { ChevronDown, HelpCircle, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The Multi-Link block above the batch panel, rebuilt to the owner's reference
 * screenshot (`public/downloadandlanding arrangement.jpg`, 2026-08-25).
 *
 * Structure, top to bottom: heading with a "?" beside it, then the tappable
 * "＋ Multiple Links" row carrying an "Up to N" pill — both inside ONE card.
 *
 * The reference also had a row of three capability chips between the two.
 * Removed on the owner's instruction (2026-08-25) — see the note where they
 * used to render. What is left is the heading, the "?", and the control.
 *
 * ── Where the description went ────────────────────────────────────────────
 * It is not rendered at rest at all. Owner: "hide the multilink gray
 * description … it occupied a lot of space in hero section", then "no need for
 * the learn me there, you just put a question mark at the top of the multi
 * link H1 text". So the explanation lives behind the "?" and floats ABOVE the
 * layout when opened — the requirement was literally "so it doesnt occupy
 * space", and a block that expands in place occupies space by definition and
 * would push the paste box down, which is a layout shift on the page whose CLS
 * was once measured at 0.684.
 *
 * ── Where the daily allowance went ────────────────────────────────────────
 * Into the opened panel (`PlanStrip`, multi-link-panel.tsx). Owner: "put the
 * batch remaining to show after the plus multi link button is clicked". That
 * also removes the last reason the COLLAPSED card would need per-visitor data,
 * so nothing here waits on a request — see multi-link-button.tsx.
 */

export function MultiLinkIntro({
  open,
  onToggle,
  sourceLimit,
  isPro,
  surface = "card",
}: {
  open: boolean;
  onToggle: () => void;
  sourceLimit: number;
  isPro: boolean;
  surface?: "hero" | "card";
}) {
  const onHero = surface === "hero";

  const [showDetail, setShowDetail] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after 3s (owner). Hovering pauses it — reading the sentence
  // should not be a race against a timer.
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
      className={cn(
        "mt-3 rounded-2xl border p-3 sm:p-4",
        onHero ? "border-white/15 bg-white/[0.06] text-white" : "border-border bg-card text-foreground",
      )}
    >
      {/* ── Heading + the "?" ──────────────────────────────────────────── */}
      <div className="relative flex items-start gap-2">
        {/*
          ── THE PREMIUM LINE (owner, 2026-08-25) ────────────────────────────
          "should be designed and decorated as a premium visible sentence, with
          premium brand color splash like as the hero H1 … but this should be
          more premium with premium stylish luxurious font."

          ── 🔴 THIS SETTLED AFTER TWO REVERSALS. READ BEFORE CHANGING IT ─────

          1. First pass reused `font-brand` (Outfit, the wordmark face) to avoid
             a new webfont on a page with a 1.6s LCP budget.
          2. Owner overruled that: "dont use the frenzsave brand font, use a more
             premium stylish font that havent been used before" → a third face,
             Playfair Display, bold italic.
          3. Owner reversed again, and this is the current instruction: *"is best
             to reuse the frenzsave brand font that is at the top of the download
             page, and the multi link text shouldnt carry all colored, only the
             middle text should be colored, just the Download. Discover. Explore
             Hero H1 style."*

          So it is `font-brand` — Outfit, the same face as the wordmark at the
          top of this very page — and Playfair was removed from the project
          entirely rather than left loaded for nothing.

          The two things that make it read as premium are now the SAME two the
          hero H1 uses, not a bespoke treatment: the display face, and a gradient
          on exactly one word. See the span below for why one word matters.

          The heading STAYS despite "…, all in one place." being cut: the "?" is
          anchored beside it by the owner's earlier instruction ("you just put a
          question mark at the top of the multi link H1 text"), so removing the
          H1 outright would orphan the affordance that holds the description.
        */}
        <h3
          id="multi-link-heading"
          className={cn(
            "font-brand text-balance text-lg font-bold leading-snug sm:text-xl",
            onHero ? "text-white" : "text-slate-900 dark:text-white",
          )}
        >
          Save{" "}
          {/*
            🔴 ONLY THE MIDDLE WORD IS COLOURED — the hero H1's exact device
            (owner, 2026-08-25: "the multi link text shouldnt carry all colored,
            only the middle text should be colored, just the Download. Discover.
            Explore Hero H1 style").

            The hero sets "Save." and "Explore." in ink and gives the
            gradient to "Discover." alone. That works BECAUSE it is one word:
            a gradient across a whole line has nothing to contrast against, so
            it stops reading as emphasis and starts reading as a coloured
            heading — which is what the previous all-gradient version did.

            Same stops as the hero (`from-blue-600 via-violet-600 to-fuchsia-600`
            with its own dark ramp), NOT a bespoke set: two nearly-identical
            gradients on one page is the kind of drift that makes a design
            system stop being one.
          */}
          <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400">
            multiple
          </span>{" "}
          links
        </h3>

        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          aria-expanded={showDetail}
          aria-controls="multi-link-detail"
          aria-label={showDetail ? "Hide what batch download does" : "What does this do?"}
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            showDetail
              ? "bg-primary text-primary-foreground"
              : onHero
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <HelpCircle aria-hidden className="h-4 w-4" />
        </button>

        {/*
          🔴 Centred through the LAYOUT (`inset-x-0 mx-auto`), never with
          `-translate-x-1/2` (owner, with a screenshot: "it opens the mockup in
          an unprofessional position" — it was hanging off the right edge).
          That class and `animate-fade-up` both write `transform`, and the
          animation wins: its keyframes end at `translateY(0)`, silently
          discarding the horizontal centring, so the card was positioned with
          its LEFT edge at the midpoint. Layout centring cannot collide with an
          animation because the two no longer touch the same property.
        */}
        {showDetail ? (
          <div
            id="multi-link-detail"
            role="status"
            aria-live="polite"
            onMouseEnter={() => {
              if (hideTimer.current) clearTimeout(hideTimer.current);
            }}
            onMouseLeave={() => setShowDetail(false)}
            className={cn(
              "animate-fade-up absolute inset-x-0 top-full z-20 mx-auto mt-2 w-full rounded-xl border p-3 text-left text-sm leading-relaxed shadow-luxury",
              onHero
                ? "border-white/15 bg-[#0b1020]/95 text-white/85 backdrop-blur"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            Add links from the same platform or mix different supported platforms into one batch.
            Fetch, choose what you want, and download everything together.
          </div>
        ) : null}
      </div>

      {/*
        ── The capability chips are GONE (owner, 2026-08-25, with a screenshot
           of the row: "remove this section from the multi link card") ────────

        They were "Same platform · Mixed platforms · Batch download", from the
        reference. Every one of them restated a sentence that is already behind
        the "?" above — so at rest they cost three rows of the hero and taught
        nothing the control below does not already say ("Add up to N links at
        once"). Nothing else read `CHIPS`; the icons went with it.
      */}

      {/* ── The control. The whole row is the button (§5 of the earlier
             brief) — on a phone that is the difference between a control you
             can hit and one you aim at. ─────────────────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="multi-link-panel"
        className={cn(
          /*
            🔴 SLIMMER (owner, 2026-08-25: "make the multi link cta more
            slimmer when the intro font reduce space").

            The italic heading gives back vertical space, and this row is where
            it should go — the card was two tall blocks stacked, which is what
            made it feel heavy in the hero. `py-2` + a 8×8 tile instead of
            `py-2.5` + 9×9 takes ~10px off the row.

            🔴 The tap target is NOT reduced below the 44px floor: 32px tile +
            16px padding = 48px, and the whole row is the button (§5), so this
            is still a full-width target. Slimming chrome must never become
            slimming the thing a thumb has to hit.
          */
          "mt-2.5 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          onHero
            ? "border-white/20 bg-white/[0.07] hover:bg-white/[0.12]"
            : "border-border bg-background hover:border-primary/40 hover:bg-secondary/40",
          open && (onHero ? "border-white/35 bg-white/[0.12]" : "border-primary/50 bg-secondary/40"),
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            onHero ? "bg-white/10 text-white" : "bg-secondary text-foreground",
          )}
        >
          <Layers aria-hidden className="h-[15px] w-[15px]" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">
            <span aria-hidden>＋</span> Multiple Links
          </span>
          <span className={cn("mt-0.5 block text-xs", onHero ? "text-white/70" : "text-muted-foreground")}>
            Add up to {sourceLimit} links at once
          </span>
        </span>

        {/* The "Up to N" pill from the reference. Carries the Pro tier when
            that is what the visitor has, so the same element answers "how many
            can I add" for both plans instead of two different affordances. */}
        <span
          className={cn(
            "shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold",
            onHero ? "bg-white/15 text-white" : "bg-primary/10 text-primary",
          )}
        >
          Up to {sourceLimit}
          {isPro ? " · PRO" : ""}
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
