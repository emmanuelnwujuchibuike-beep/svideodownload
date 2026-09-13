"use client";

import { useEffect, useState } from "react";

import { CharacterReplaceEntry } from "@/features/ai/character-replace/character-replace-entry";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAIAllowanceBar, FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { FrenzAIToolGrid } from "@/features/ai/frenz-ai-tool-grid";
import { FrenzAITierLabel } from "@/features/ai/frenz-ai-tier-label";
import { getAiEntitlement, type AiMemberEntitlement } from "@/lib/ai/client";

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
 * ── 🔴 2026-09-13: THE HERO IS GONE ─────────────────────────────────────────
 *
 * Owner: "Remove this AI welcome hero, the images and all — a new AI model,
 * Wan 2.2, will be introduced part by part in the next session and it will be
 * the main AI model and tools, not AI Clean, although AI Clean will still
 * exist." Everything above the allowance bar was that hero. The page now
 * opens with a plain title and keeps the allowance bar, the tier row, the
 * trust row and the tool grid. See the note at the top of the JSX.
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
  characterReplaceHref = "/studio/ai/character-replace",
  historyHref = "/studio/ai/history",
  usageHref = "/studio/ai/usage",
}: {
  characterReplaceHref?: string;
  historyHref?: string;
  usageHref?: string;
}) {
  const [entitlement, setEntitlement] = useState<AiMemberEntitlement | null>(null);

  useEffect(() => {
    let alive = true;
    void getAiEntitlement().then((res) => {
      // A refusal is not an error worth showing here: the bar simply stays
      // hidden and the page is still entirely usable.
      if (alive && res.ok) setEntitlement(res as unknown as AiMemberEntitlement);
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
        {/*
          ── 🔴 THE HERO IS GONE, ON PURPOSE (owner, 2026-09-13) ──────────────

          "Remove this AI welcome hero, the images and all, because a new AI
          model, Wan 2.2, will be introduced part by part in the next session
          and it will be the main AI model and tools — not AI Clean, although
          AI Clean will still exist."

          What stood here: the "Frenz AI / AI Clean" crumb, the "Clean your
          videos with AI." headline with the mark set into it, the subhead, the
          before/after mountain scene (FrenzAIBeforeAfterScene) and the two
          actions (How it works / Try AI Clean). All of it described ONE tool,
          and that tool is about to stop being the headline act.

          What remains is deliberately plain: a page title, then the things the
          owner kept by name on 09-09 (the allowance bar, the tier row), the
          trust row, and the tool grid — which is still every door this product
          has, AI Clean included. The next session puts Wan 2.2's own hero here.
          Nothing was moved to make that easier; nothing should be.
        */}
        <h1 className="text-[1.6rem] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[1.9rem]">
          Frenz <span className="text-gradient">AI</span>
        </h1>

        {/*
          ── THE HERO SLOT, FILLED (2026-09-13) ───────────────────────────────

          The block above the allowance bar is where the AI Clean hero stood
          and was cleared "to make room" for Wan 2.2. Character Replace's
          entry card (Part 1, §5) is what it was cleared for: the product's
          mark, the owner's three lines, one action. `offered` comes from the
          server's entitlement — when the operator switches the tool off the
          action becomes a sentence, and until the entitlement answers the
          card is drawn as available (a flash of "not available" would be a
          claim about a switch nobody has read yet).
        */}
        <CharacterReplaceEntry
          href={characterReplaceHref}
          available={entitlement ? entitlement.offered : true}
          className="mt-5"
        />

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
          ── 🔴 THE BALANCE CARD IS NOT ON THIS PAGE ANY MORE (2026-09-13) ──

          Owner, 2026-09-09: "I still don't see the dashboard… it should be on
          this page." It was added here AND on the AI Clean page. Owner,
          2026-09-13, with the AI Clean page on screen: "the balance card
          should only be in the AI page main input page, not on the welcome
          too." So it lives on AI Clean (ai-clean-empty-state.tsx) — the page
          where a video is chosen and a price is about to matter — and not
          here. The allowance bar and tier row above stay: they are the plan
          description and the amount left, kept explicitly on 09-09.
        */}

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

          Two columns at every width, painted previews rather than photographs.
          Two cards now — AI Clean and history — since the owner removed the
          "Soon" cards on 2026-09-13, and no "More AI Tools" header above them
          since the same day ("Remove this section"); see the component.
        */}
        <FrenzAIToolGrid historyHref={historyHref} usageHref={usageHref} className="mt-8" />
      </div>
    </FrenzAIEnvironment>
  );
}
