"use client";

import { ArrowRight, HelpCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FrenzAIBeforeAfterScene } from "@/features/ai/core/frenz-ai-before-after-scene";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAIAllowanceBar, FrenzAICrumb, FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { FrenzAIDashboard } from "@/features/ai/frenz-ai-dashboard";
import { FrenzAIToolGrid } from "@/features/ai/frenz-ai-tool-grid";
import { FrenzAITierLabel } from "@/features/ai/frenz-ai-tier-label";
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
export function FrenzAIWelcome({
  cleanHref = "/studio/ai/clean",
  historyHref = "/studio/ai/history",
}: {
  cleanHref?: string;
  historyHref?: string;
}) {
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
          🔴 KEPT, EXPLICITLY. Owner, 2026-09-09: "Do not remove the existing
          plan description and the amount left and used." The reference
          screenshot does not draw these, and building only what it draws would
          have quietly deleted the one thing on this page that tells somebody
          what they have left.
        */}
        <FrenzAIAllowanceBar entitlement={entitlement} className="mt-4" />

        {/*
          The tier row: what this plan gets, or what the next one adds. Free
          sees the upgrade, Pro sees what it already has — see the component.
        */}
        <FrenzAITierLabel entitlement={entitlement} variant="row" className="mt-4" />

        {/*
          ── 🔴 THE DASHBOARD (owner, 2026-09-09) ──────────────────────────

          "I still don't see the dashboard and all we have been doing about the
          dashboard, deposit, usage and all, it should be on this page."

          Balance, both free counters, the price per video, the recharge
          amounts and recent ledger activity. It renders NOTHING until it has
          real numbers — see the component for why a skeleton of zeroes is a
          statement about somebody's account rather than a placeholder.
        */}
        <FrenzAIDashboard historyHref={historyHref} className="mt-4" />

        {/*
          ── 🔴 THE HISTORY LINK IS GONE FROM HERE, NOT DELETED ──────────────

          It moved into the tool grid below as a full card, which is what the
          owner asked for ("replace 1 card that isn't a real feature with the
          Ai history button"). Leaving this row as well would put the same
          destination on the page twice, three inches apart — the "cluster" the
          same instruction warns against.
        */}

        <FrenzAITrustRow className="mt-6" />

        {/*
          ── 🔴 THE TOOL GRID, AS DRAWN ─────────────────────────────────────

          Owner, 2026-09-09, with a full-page screenshot: "Make the Ai welcome
          page to be exactly like this in details no simplifying… on all
          devices the Down section should be grid."

          Two columns at every width, painted previews rather than photographs,
          and the AI history as one of the four cards. See the component for
          why the fourth card is history rather than the "AI Text Remover" the
          reference draws.
        */}
        <FrenzAIToolGrid cleanHref={cleanHref} historyHref={historyHref} className="mt-8" />
      </div>
    </FrenzAIEnvironment>
  );
}
