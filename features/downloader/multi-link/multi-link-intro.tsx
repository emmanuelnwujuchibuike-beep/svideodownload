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

          Three things make it, and each one is chosen against a constraint:

          1. THE FACE — `font-luxe`, Playfair Display. A THIRD face, added for
             this line (app/layout.tsx has the full note).

             🔴 This overrules a first pass that reused the Outfit wordmark face
             to avoid a new font file. Owner: "dont use the frenzsave brand
             font, use a more premium stylish font that havent been used before
             for the multi link H1 intro." That rules out both faces already
             loaded, so a new one is the instruction, not a drift.

             The cost is real and is paid down the same way the wordmark's is —
             one weight, `preload:false`, `display:swap` — so it never competes
             with the LCP element and never blocks first paint. A high-contrast
             SERIF is also the honest reading of "luxurious": that thick-to-thin
             modulation is what the eye reads as luxury, and it is exactly what
             Inter and Outfit, both sans, cannot do.

          2. THE SPLASH — richer than the hero's, on purpose. The hero tints ONE
             word out of three (`Discover.`) because the other two have to stay
             quiet around it. Here the whole line is the subject, so the gradient
             runs across all of it and travels further round the wheel
             (blue → indigo → violet → fuchsia), which is what reads as "more
             premium" rather than merely "same treatment, second time".
             `text-transparent` + `bg-clip-text`, the same mechanism the hero and
             `.text-gradient` use — no new idiom.

          3. THE TYPE ITSELF — BOLD ITALIC (owner: "a bold font with a stylish
             italic style"), a size bump, and NO negative tracking. All three
             live in `.font-luxe` rather than here, because only the 700-italic
             cut of Playfair is loaded and an element that renders it upright
             matches no `@font-face` at all — it would fall back to Georgia
             without erroring. High-contrast serifs are drawn to be set open;
             the tightening that flatters a geometric wordmark closes these
             counters and cheapens them. Luxury type is set OPEN, not squeezed.

          🔴 The dark-mode stops are separate and lighter. A 600-weight gradient
          that reads rich on white goes muddy on #0b1020 — the same reason the
          hero declares its own `dark:` ramp instead of letting one set serve
          both.

          The heading STAYS despite "…, all in one place." being cut: the "?" is
          anchored beside it by the owner's earlier instruction ("you just put a
          question mark at the top of the multi link H1 text"), so removing the
          H1 outright would orphan the affordance that holds the description.
        */}
        <h3
          id="multi-link-heading"
          className={cn(
            // `font-luxe` carries the face, the 700 weight AND the italic (see
            // globals.css) — only that one cut is loaded, so none of the three
            // is optional here.
            "font-luxe text-balance bg-clip-text text-lg leading-snug text-transparent sm:text-xl",
            /*
              🔴 A literal `linear-gradient`, not `from-/via-/to-`. Tailwind's
              `via-` is ONE stop — two `via-` classes emit the same custom
              property and the later simply overwrites the earlier, so the
              four-stop ramp described above is not expressible in that API. It
              would have compiled, linted and silently rendered a three-stop
              gradient. Written out, the extra stop actually exists.
            */
            onHero
              ? "bg-[linear-gradient(100deg,#93c5fd_0%,#c4b5fd_45%,#f0abfc_100%)]"
              : [
                  "bg-[linear-gradient(100deg,#2563eb_0%,#4f46e5_28%,#7c3aed_58%,#c026d3_100%)]",
                  "dark:bg-[linear-gradient(100deg,#60a5fa_0%,#818cf8_28%,#a78bfa_58%,#e879f9_100%)]",
                ],
          )}
        >
          Download multiple links
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
