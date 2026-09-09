"use client";

import { ArrowRight, HelpCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FrenzAIBeforeAfterScene } from "@/features/ai/core/frenz-ai-before-after-scene";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAIAllowanceBar, FrenzAICrumb, FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { FrenzAICleanFab } from "@/features/ai/frenz-ai-clean-fab";
import { FrenzAIHistory } from "@/features/ai/frenz-ai-history";
import { getAiCleanEntitlement, type AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI WELCOME PAGE — what opens when somebody taps Frenz AI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from `public/frenz ai welcome page.jpg` (owner, 2026-09-08: "everything
 * just be exactly as it is in the images, no minimising no simplifying, only do
 * not break the performance and over heating rule").
 *
 * Top to bottom, as drawn: the breadcrumb pill, the headline with "videos" in
 * brand gradient and the mark set into it, the subhead, the before/after scene,
 * How it works + Try AI Clean, the allowance bar, and the trust row.
 *
 * ── 🔴 THE PERFORMANCE RULE IS AN INSTRUCTION, NOT A PREFERENCE ─────────────
 *
 * "do not break the performance and over heating rule" is in the same sentence
 * as "no simplifying", so both are the brief. What that costs here:
 *
 *   · not one photograph. The two video frames are CSS gradients, the marks are
 *     the existing brand PNG at 16-30px, and the glass is `` on
 *     small boxes rather than across the page;
 *   · nothing animates except four spheres and the centre mark, on 9-16 second
 *     cycles, on `transform`/`opacity` only;
 *   · all of it stops under `prefers-reduced-motion` and on a hidden tab,
 *     through the same `--ai-play` variable the whole environment uses.
 *
 * A landing screen that warms a phone in the pocket is not premium, whatever it
 * looks like in a screenshot.
 *
 * ── One client component, because of one fetch ──────────────────────────────
 *
 * Only the allowance needs the network. It is fetched once on mount rather than
 * rendered on the server, because this page must stay cheap to render and the
 * count is the one thing on it that changes minute to minute. Until it arrives
 * the bar renders NOTHING — a flash of "0 of 0" would show a limit to somebody
 * who has not reached one.
 */
export function FrenzAIWelcome({ cleanHref = "/studio/ai/clean" }: { cleanHref?: string }) {
  const [entitlement, setEntitlement] = useState<AiCleanEntitlement | null>(null);

  useEffect(() => {
    let alive = true;
    void getAiCleanEntitlement().then((res) => {
      // A refusal is not an error worth showing here: the bar simply stays
      // hidden and the page is still entirely usable.
      if (alive && res.ok) setEntitlement(res as unknown as AiCleanEntitlement);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <FrenzAIEnvironment stage="idle" className="relative overflow-hidden rounded-[1.75rem]">
      {/* the room's light — static, and well under the text */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 40% at 20% 0%, rgba(99,102,241,0.13) 0%, transparent 62%)," +
            "radial-gradient(60% 40% at 92% 26%, rgba(217,70,239,0.11) 0%, transparent 66%)",
        }}
      />

      <div className="px-4 pb-6 pt-5 sm:px-6">
        <FrenzAICrumb tool="AI Clean" />

        <h1 className="mt-4 text-[2.05rem] font-bold leading-[1.06] tracking-[-0.04em] sm:text-[2.5rem]">
          Clean your{" "}
          {/*
            The mark set into the headline, as drawn. `align-middle` with a
            negative top nudge keeps it on the cap height rather than the
            baseline, which is where the reference puts it.
          */}
          <span className="relative -top-1 mx-0.5 inline-block align-middle">
            <FrenzLogo size={34} alt="" />
          </span>
          <br className="hidden sm:block" />
          <span className="text-gradient">videos</span> with AI.
        </h1>

        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Remove unwanted captions, subtitles and text overlays while keeping your video looking
          natural.
        </p>

        <FrenzAIBeforeAfterScene className="mt-7" />

        {/* ── the two actions ─────────────────────────────────────────────── */}
        {/*
          Side by side on EVERY width, as the reference draws them on a phone.
          Stacking them made "How it works" a full-width button of equal weight
          to the primary action, which is the opposite of the intended hierarchy.
        */}
        <div className="mt-7 flex items-center gap-2.5">
          <Link
            href={`${cleanHref}?tutorial=1`}
            prefetch={false}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-border/70 bg-card/95 px-4 py-3.5 sm:px-6",
              "text-[13.5px] font-semibold transition hover:border-foreground/20 active:scale-[0.99] sm:text-sm",
            )}
          >
            <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
            How it works
          </Link>

          <Link
            href={cleanHref}
            prefetch
            className={cn(
              "group inline-flex flex-1 items-center justify-center gap-2 rounded-full",
              "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 px-4 py-3.5 sm:px-6",
              "text-[13.5px] font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)] sm:text-sm",
              "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            )}
          >
            <FrenzLogo size={18} alt="" />
            Try AI Clean
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>

        {/*
          ── 🔴 THE FLOATING ACTION ────────────────────────────────────────────

          Owner, 2026-09-09: "make the clean your videos be a floating premium
          widget at the bottom right side of the history page that stick when
          scrolling up and hide when scrolling down."

          It does NOT replace the button above — that one is the first thing a
          new visitor sees and belongs in the reading order. This is the same
          action kept within reach once somebody has scrolled into their
          history, which is exactly when the inline button has left the screen.

          Rendered here rather than in `FrenzAIHistory` so the history section
          stays a pure list that any surface can mount without also getting a
          fixed-position widget it did not ask for.
        */}
        <FrenzAICleanFab href={cleanHref} />

        <FrenzAIAllowanceBar entitlement={entitlement} className="mt-4" />

        {/*
          ── 🔴 MOVED UP, BECAUSE THE OWNER COULD NOT FIND IT ─────────────────

          Owner, 2026-09-09: "I still don't see the AI history work in the AI
          page, many downloads finished while I was outside the page and I
          couldn't find them."

          It was there and it WAS deployed — the markup is in the served HTML.
          The mistake was where I put it: after the trust row, at the very
          bottom of a page that opens with a headline, a before/after scene, two
          buttons and an allowance bar. My reasoning was that "somebody
          returning for a finished video is scrolling with intent and will find
          it". They did not, and the reasoning was wrong on its own terms —
          coming back for a finished video is one of the two things this screen
          exists for, so it cannot be the last thing on it.

          It now sits directly under the allowance bar: still below the primary
          action, because a first visit should open on "clean a video", but
          above the trust row and within one scroll.

          Inside the environment wrapper, so its surfaces read the same four CSS
          variables as the rest of the page — a surface with no
          `FrenzAIEnvironment` ancestor silently falls back to the defaults.
        */}
        <FrenzAIHistory className="mt-7" />

        <FrenzAITrustRow className="mt-6" />
      </div>
    </FrenzAIEnvironment>
  );
}
