"use client";

import { ArrowRight, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI VIGNETTE — two seconds after landing, once
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "Put a premium, luxurious and professional landing
 * vignette and button that tell users to try the new frenz Ai to remove
 * captions from Videos and images, the Landing vignette should show after 2secs
 * of landing in the landing and Download page."
 *
 * ── 🔴 THIS IS NOT THE MONETAG VIGNETTE, AND MUST NOT BE CONFUSED WITH IT ───
 *
 * There is an ad format of the same name wired into this site, and a recorded
 * finding that it can never appear at the moment it is triggered — its loader
 * arms on load and shows on a LATER navigation. This is OUR panel: a product
 * announcement, no network call, no ad, no third-party script. It is named for
 * the shape the owner asked for, not the ad unit.
 *
 * ── Shown ONCE, and remembered ──────────────────────────────────────────────
 *
 * A promotion that reappears on every visit is not a promotion, it is a
 * nuisance, and the fastest way to teach somebody to dismiss it without
 * reading. `localStorage` is the right store for this and one of the few
 * things it is allowed to hold in this codebase: it is a per-device
 * convenience, never an entitlement, never authority. Nothing here is read
 * back by the server.
 *
 * ── Why 2 seconds and not immediately ───────────────────────────────────────
 *
 * Landing at the same instant as the page would make it feel like an
 * interstitial the visitor has to get past to reach the site. Two seconds is
 * long enough that the page is theirs first, short enough to be seen.
 *
 * ── The performance rule ────────────────────────────────────────────────────
 *
 * The landing page has a 1.6-second budget, so this is dynamically imported by
 * its mount, renders nothing until the timer fires, uses no image and no
 * backdrop-blur, and animates one entrance transform. It is portalled to
 * `document.body` — a standing law here, because a `position: fixed` element
 * inside blurred or transformed chrome is positioned against that ancestor
 * instead of the viewport.
 */

const SEEN_KEY = "frenzsave:frenz-ai-vignette:v1";
const DELAY_MS = 2_000;

export function FrenzAIVignette() {
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // A browser with storage blocked shows it each visit rather than never.
      // Erring toward showing a product announcement is the harmless direction.
    }
    if (seen) return;

    const timer = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // A second frame before the entrance transform, so it animates in rather than
  // appearing already finished.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  const dismiss = () => {
    /*
      🔴 GONE ON THE TAP (owner, 2026-09-08: "the vignette try frenz ai exit
      button doesnt click and exit immediatel").

      This used to set `entered = false` and unmount 200ms later, so the exit
      animation could play. On a phone that reads as a dead button: you tap, the
      thing is still there, so you tap again. A dismissal is the one interaction
      that must never wait for a flourish — the person has already told you they
      do not want to look at it.

      The entrance animation stays. Arriving gently is pleasant; leaving slowly
      is not.
    */
    setOpen(false);
    setEntered(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* nothing to do — it simply shows again next time */
    }
  };

  if (!open) return null;

  return (
    <Portal>
      {/*
        `aria-live` rather than a dialog role: this announces something, it does
        not demand an answer. Making it a modal would trap focus and force an
        interaction for a message the visitor is free to ignore.
      */}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "fixed inset-x-3 bottom-[calc(4.75rem+var(--frenz-safe-bottom,0px))] z-[60] mx-auto max-w-md",
          "transition-all duration-300 ease-out motion-reduce:transition-none",
          entered ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          "sm:bottom-6",
        )}
      >
        {/*
          🔴 WHITE AND BLUE (owner, 2026-09-08: "the vignette color should be
          white and blue not all dark blue").

          The dark slab read as an ad interstitial — the very thing this must
          not be mistaken for on a page that also carries real ad units. A light
          card on the page's own ground reads as the product speaking, and the
          blue carries the brand without shouting.
        */}
        <div className="relative overflow-hidden rounded-[1.5rem] bg-white p-4 text-slate-900 shadow-[0_24px_60px_-20px_rgba(30,58,138,0.35)] ring-1 ring-inset ring-blue-500/15 dark:bg-[#0d1330] dark:text-white dark:ring-white/10">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-70"
            style={{
              background:
                "radial-gradient(circle, rgba(59,130,246,0.28) 0%, rgba(99,102,241,0.14) 45%, transparent 70%)",
            }}
          />

          {/*
            🔴 z-[2], AND THAT ONE DIGIT IS THE WHOLE BUG.

            Owner, 2026-09-08: "the frenz ai vignette skip button doesnt click on
            first tap."

            It was `z-[1]` — the same as the content row below it, which is
            `relative z-[1] … pr-8`. Equal z-index means DOM ORDER decides, and
            the content row comes later, so it painted over the button. Its
            `pr-8` reserves the SPACE for the X but the element still spans that
            region and still receives the taps.

            Measured on production with `elementFromPoint` at the button's exact
            centre:

                div.relative.z-[1].flex  <  div.relative.overflow-hidden…

            — the content row, not the button. Only the sliver of the X above
            that row's top edge was hittable, which is why it took a second or
            third try rather than never working: a big enough target to find by
            accident, small enough to miss every time you aim for the middle.

            Nothing else on this card needs to sit above the content, so raising
            just this one control is the whole fix.
          */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute right-2.5 top-2.5 z-[2] flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/[0.06] text-slate-500 transition hover:bg-slate-900/10 hover:text-slate-900 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>

          <div className="relative z-[1] flex items-start gap-3 pr-8">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/30">
              <Wand2 className="h-5 w-5 text-white" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">New</p>
              <p className="mt-0.5 text-[15px] font-bold leading-tight">Try Frenz AI</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-white/70">
                Remove captions, subtitles and text from your videos and images — free to try.
              </p>
            </div>
          </div>

          <Link
            href="/ai"
            prefetch={false}
            onClick={dismiss}
            className="relative z-[1] mt-3.5 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-500 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_-10px_rgb(37_99_235/0.9)] transition active:scale-[0.99]"
          >
            Try AI Clean
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Portal>
  );
}
