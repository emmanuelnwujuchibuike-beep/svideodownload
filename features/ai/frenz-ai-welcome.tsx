"use client";

import {
  ArrowRight,
  AudioLines,
  Clapperboard,
  ImagePlus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FrenzAIAllowanceBar, FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiHero } from "@/features/ai/design/ai-surface";
import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
import { getAiEntitlement, type AiMemberEntitlement } from "@/lib/ai/client";
import {
  readAiEntitlementCache,
  writeAiEntitlementCache,
} from "@/lib/ai/entitlement-cache";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI WELCOME PAGE — the front door of the studio
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rebuilt 2026-09-20 from the owner's reference screen ("Create. Transform.
 * Perfect.") as a native-app screen rather than a page about one tool:
 *
 *   AI STUDIO · the headline · one supporting line
 *   THE STUDIO CARD · the four capability groups · Explore AI Studio
 *
 * Nothing below the button (owner, later the same day: "remove the AI tools
 * down to AI credits from the welcome page; let it be the main Explore AI
 * Studio page") — the grid of every feature, the three steps and credits &
 * usage live on the Explore page (features/ai/frenz-ai-explore.tsx), which
 * the button opens.
 *
 * ── What the page says is what the product does ─────────────────────────────
 *
 * Both of the things this note used to say were missing have shipped: Text to
 * Audio (2026-09-21) and Voice Cloning (2026-09-27). The rule behind the note
 * still holds and is the reason to keep reading it — a card that leads nowhere
 * is a claim, not a feature, so nothing is named here until its page exists. No
 * provider or model is named on this page (Part 9 §7).
 *
 * ── The performance rule ────────────────────────────────────────────────────
 *
 * Not one photograph and no hero figure (owner: the headline takes the width);
 * the only animation is the call to action's ambient light, which is a
 * transform on a wider layer (compositor only, 9 s per pass), paused by the
 * environment's `--ai-play` on a hidden tab and stopped under reduced motion.
 * The one fetch is the entitlement (for `offered` and the plan chip); it paints
 * from its last answer first, so the page never reflows on entry.
 */
/**
 * ── 🔴 REWRITTEN 2026-10-04: THIS CARD DESCRIBED A PRODUCT THAT NO LONGER
 *    EXISTS ──────────────────────────────────────────────────────────────────
 *
 * Owner: "this page still describes the old replicate features and design,
 * update it and make each card less cluster."
 *
 * Every one of the four groups was Character Replace's settings panel, written
 * when that was the only tool: "Face Only / Face + Head / Upper Body / Full
 * Character" are its four scopes, "Voice Replace", "Trim & Quality", "Original
 * Audio" and "Your Recording" are its options. Part 5 retired it — the direct
 * Kling API has no endpoint that takes a base video plus a character — so the
 * front door of the studio was advertising, in its entirety, the one thing the
 * studio cannot do. Every name here now resolves to a page that exists and a
 * feature registered in `AI_FEATURES`.
 *
 * ── Why the bullet lists are gone ──────────────────────────────────────────
 *
 * That is the "cluster": each card carried a dot-marked list of sub-options AND
 * a paragraph explaining them, so four cards put twenty-odd pieces of text on a
 * screen whose entire job is to get somebody to press one button. A tool is a
 * title and a sentence; the full list is the Explore page's job
 * (`aiToolCards`), which is one tap away and is the studio's real table of
 * contents.
 */
const CATEGORIES = [
  {
    id: "text_to_video",
    icon: Sparkles,
    tint: "bg-violet-500/[0.10] text-violet-600 dark:text-violet-300",
    title: "Text to Video",
    detail:
      "Describe a scene and get it filmed — realistic, cartoon, anime, or any style you can put into words.",
  },
  {
    id: "image_to_video",
    icon: ImagePlus,
    tint: "bg-blue-500/[0.10] text-blue-600 dark:text-blue-300",
    title: "Image to Video",
    detail:
      "Give one photo motion. Say how it should move, in any style, and it becomes a clip.",
  },
  {
    id: "lip_sync",
    icon: Clapperboard,
    tint: "bg-fuchsia-500/[0.10] text-fuchsia-600 dark:text-fuchsia-300",
    title: "Lip Sync",
    detail: "Match any video's mouth to any voice, in any language.",
  },
  {
    id: "voice_audio",
    icon: AudioLines,
    tint: "bg-indigo-500/[0.10] text-indigo-600 dark:text-indigo-300",
    title: "Voice & Audio",
    detail:
      "Type it and hear it spoken — or clone a voice you own and keep it.",
  },
] as const;

export function FrenzAIWelcome({
  characterReplaceHref = "/studio/ai/character-replace",
}: {
  /** Explore AI Studio — the one door on this page. */
  characterReplaceHref?: string;
}) {
  /*
    Painted from the last answer first (owner, 2026-09-13: "this section
    reloads every time I enter the page or backswipe"). The network still
    replaces it on every mount; the cache puts the plan chip on screen at the
    first frame. See lib/ai/entitlement-cache.ts.
  */
  const [entitlement, setEntitlement] = useState<AiMemberEntitlement | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    // In the effect, not the initial state: the prerendered markup has no
    // entitlement, and an initial state that differs from it is a hydration
    // mismatch. The cached paint lands one frame after hydration.
    const cached = readAiEntitlementCache();
    if (cached) setEntitlement((current) => current ?? cached);
    void getAiEntitlement().then((res) => {
      // A refusal is not an error worth showing here: the page is entirely usable without it.
      if (alive && res.ok) {
        const { ok: _ok, ...view } = res;
        const next = view as unknown as AiMemberEntitlement;
        setEntitlement(next);
        writeAiEntitlementCache(next);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Until the entitlement answers the studio is drawn as open: "not available" is a claim about a switch nobody has read yet.
  const available = entitlement ? entitlement.offered : true;

  return (
    <>
    <FrenzAIEnvironment
      stage="idle"
      /*
        ── THE SHARED GROUND (owner, 2026-09-27) ─────────────────────────
        This carried two `radial-gradient` strings inline, and the studio
        card below carried two more — four definitions of a background that
        both of the owner's references show as ONE light iridescent wash. A
        member moving from here into a tool was moving between two colours.

        `.ai-wash` is that wash, once, in globals.css.
      */
      className="ai-wash relative overflow-hidden rounded-[1.75rem]"
    >

      <div className="px-4 pb-6 pt-5 sm:px-6 sm:pt-6">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        {/* owner, 2026-09-20: no figure — the headline takes the whole width and runs horizontally */}
        {/*
          The shared hero. The owner's 2026-09-20 decision holds — no figure,
          the headline takes the whole width — and the breadcrumb pill from
          both references now opens it, so the front door and every tool
          behind it start the same way.
        */}
        <AiHero
          tool="AI Studio"
          title="Create. Transform."
          highlight="Perfect."
          subtitle="Professional AI tools for video, voice and audio creation."
          className="px-0"
        />


        {/* ── THE STUDIO CARD ──────────────────────────────────────────────── */}
        <section
          aria-labelledby="ai-studio-title"
          className={cn(
            "relative mt-6 overflow-hidden rounded-[1.75rem] bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-6",
            "shadow-[0_20px_48px_-30px_rgba(15,23,42,0.35)]",
          )}
        >

          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.95rem] bg-[#131a4a] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_-14px_rgba(19,26,74,0.7)]">
              <FrenzLogo size={24} alt="" />
            </span>
            <div className="min-w-0">
              <h2
                id="ai-studio-title"
                className="text-[17px] font-bold leading-tight tracking-[-0.02em] sm:text-[19px]"
              >
                Frenz AI Studio
              </h2>
              <p className="mt-0.5 text-[12.5px] leading-tight text-muted-foreground sm:text-[13px]">
                All-in-one AI creation suite
              </p>
            </div>
            <span className="ml-auto hidden shrink-0 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-[11px] font-semibold text-primary sm:inline-flex">
              Video · Voice · Audio
            </span>
          </div>

          {/*
            The allowance bar, from the reference ("14 of 15 free cleans left
            today"). It already existed in frenz-ai-chrome.tsx and was rendered
            on ONE page; the front door — where somebody decides whether to
            start — did not show it at all. It renders nothing for a paid-only
            or unlimited plan, so it cannot invent a limit nobody is under.
          */}
          <FrenzAIAllowanceBar entitlement={entitlement} className="mt-4" />

          {/* the four groups — what the studio does, readable in a few seconds */}
          <ul
            className="mt-4 grid grid-cols-2 gap-2 sm:gap-2.5"
            aria-label="What Frenz AI Studio does"
          >
            {CATEGORIES.map((c) => (
              <li
                key={c.id}
                className="rounded-[1.15rem] bg-secondary/55 p-3 ring-1 ring-inset ring-black/[0.035] dark:bg-white/[0.04] dark:ring-white/[0.06]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem]",
                      c.tint,
                    )}
                  >
                    <c.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <h3 className="text-[12.5px] font-bold leading-tight tracking-[-0.01em]">
                    {c.title}
                  </h3>
                </div>
                {/*
                  One sentence, and that is the whole card. The dot-marked list
                  of sub-options that used to sit here is gone with the tools it
                  listed — see the note on CATEGORIES.
                */}
                <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
                  {c.detail}
                </p>
              </li>
            ))}
          </ul>

          {!available ? (
            <p className="mt-5 rounded-full bg-secondary px-5 py-3.5 text-center text-[13.5px] font-semibold text-muted-foreground">
              Not available right now. Check back soon.
            </p>
          ) : null}
          <p className="mt-4 text-center text-[12px] leading-snug text-muted-foreground">
            Upload media or enter text and the tool creates a new result with
            AI. Processing time and credits vary by tool.
          </p>
        </section>

        {/*
          The trust row that closes BOTH references — Secure · Fast · Natural
          Results. It has existed in frenz-ai-chrome.tsx since the visual work
          began and was rendered on ZERO pages, which is a fair summary of how
          much of the reference had actually been built.
        */}
        <FrenzAITrustRow className="mt-7 border-t border-border/60 pt-5" />
      </div>
    </FrenzAIEnvironment>

    {/*
      ── EXPLORE AI STUDIO — the one primary action, always in reach ──────────
      Owner, 2026-09-21: "make the Explore AI Studio button stick on top of the
      bottom nav in the AI welcome page even when the user scrolls down or up,
      and it shouldn't obstruct the write-up much."

      `sticky` against the page, docked at `--frenz-bottomnav-h` (the nav's
      measured height, 0 where none is mounted) — the same dock the workspace
      action bar uses. It rides above the text while the page scrolls and
      settles into its own place at the end, so nothing is ever covered for
      good. OUTSIDE the environment on purpose: that wrapper is
      `overflow-hidden`, and a sticky element inside an overflow-hidden
      ancestor sticks to that box instead of the viewport.

      The backdrop is a short gradient into the page background rather than a
      solid bar — the text beneath fades under it instead of being cut off.
    */}
    {available ? (
      <div
        className="pointer-events-none sticky z-20 -mx-1 -mb-3 px-1 pb-3 pt-7"
        style={{
          bottom: "var(--frenz-bottomnav-h, 0px)",
          background: "linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background) / 0.92) 55%, transparent 100%)",
        }}
      >
        <Link
          href={characterReplaceHref}
          className={cn(
            "ai-cta group pointer-events-auto flex min-h-[56px] w-full items-center justify-center gap-2.5 px-7",
            "text-[16.5px] font-semibold tracking-[-0.01em] shadow-[0_18px_40px_-20px_rgba(79,70,229,0.55)]",
            "transition-transform duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.985]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <Sparkles className="h-[18px] w-[18px] opacity-80" aria-hidden />
          Explore AI Studio
          <ArrowRight
            className="h-[18px] w-[18px] transition-transform motion-safe:group-hover:translate-x-0.5"
            aria-hidden
          />
          <LinkPendingStripe />
        </Link>
      </div>
    ) : null}
    </>
  );
}
