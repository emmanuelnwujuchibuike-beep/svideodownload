"use client";

import { ArrowLeft, FileVideo, Link2, Sparkles } from "lucide-react";

import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import type { AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * Where Continue goes — and the one screen in this feature that has to be most
 * careful about what it says.
 *
 * ── 🔴 IT DOES NOT PRETEND — AND WHAT THAT MEANS CHANGED IN PART 6 ───────────
 *
 * Part 1 shipped this as an honest dead end. The brief then was "no real AI
 * processing should happen yet", so the panel said the cleanup was not
 * connected, there was no bar, no percentage and no fake stage list, and the
 * Pro/free copy was written in the future tense because nothing had been spent.
 *
 * Part 6 connected it. The same rule now points the other way: a screen that
 * still said "nothing has been fetched" would be exactly the kind of stale
 * claim the original was written to avoid. So the panel states what is about to
 * happen, the button starts a real job, and the allowance sentence is present
 * tense because the allowance is now real and server-side.
 *
 * ── In practice this is the LINK screen ─────────────────────────────────────
 *
 * A file goes through `AICleanVideoPreview`, which has the frame, the metadata
 * and its own Continue. Only a pasted link lands here — the file branch is kept
 * because the shape costs nothing and a future entry point may want it.
 *
 * Nothing here decides anything. `onStart` calls the one state machine
 * (`useAiCleanJob.submit`), and every gate — the allowance, the ad, the URL
 * allow-list — is re-resolved server-side after that.
 */
export function AICleanReadyState({
  source,
  isPro,
  entitlement = null,
  planKnown,
  onBack,
  onStart,
  busy = false,
}: {
  source: { kind: "file"; name: string } | { kind: "link"; url: string };
  isPro: boolean;
  /**
   * The server's own answer about this member's allowance. Optional because
   * it arrives a moment after the screen does, and a sentence with a wrong
   * number in it is worse than a sentence with no number in it.
   */
  entitlement?: AiCleanEntitlement | null;
  /** False until `/api/me` has answered — see the note below. */
  planKnown: boolean;
  onBack: () => void;
  /** Start the job. Part 6: for a link this is what sends it to our worker. */
  onStart: () => void;
  /** True while the submission is in flight, so the button cannot double-fire. */
  busy?: boolean;
}) {
  const Icon = source.kind === "file" ? FileVideo : Link2;
  const label = source.kind === "file" ? source.name : source.url;

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-xl py-2 sm:py-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold tracking-[-0.01em]">Ready to clean</h2>
          <AICleanProBadge />
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This is the video AI Clean will work on.
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
            {label}
          </span>
        </div>

        {/*
          ── 🔴 THE LINK PATH IS REAL NOW (Part 6) ──────────────────────────

          This panel used to say "the cleanup itself isn't connected yet", which
          was the honest thing to render while Part 1 shipped an interface with
          nothing behind it. Our server fetches the video now, so that sentence
          would be the lie the original was written to avoid.

          What replaces it is a statement of what is about to happen, in the
          member's terms: OUR server does the fetching, not their browser and
          not their connection.
        */}
        <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            {source.kind === "file" ? "Ready when you are" : "We'll fetch this for you"}
          </p>
          <p className="mt-1.5 pl-6 text-sm leading-relaxed text-muted-foreground">
            {source.kind === "file"
              ? "Your video goes straight to private storage, and only Frenz AI reads it."
              : "Frenz AI downloads the video on our servers — nothing is sent from your device, and it keeps going if you close the app."}
          </p>
        </div>

        {/*
          ── 🔴 THE NUMBER IS READ, NOT WRITTEN ────────────────────────────────

          This sentence said "Free members get 3 AI Clean videos a day, each
          unlocked by watching a short ad." Both halves were false:
          `DEFAULT_BY_AUDIENCE.free` is `dailyLimit: 2, requiresReward: false`.

          So the product was promising a free member one more video than it
          would give them, and warning them about an ad gate that had already
          been removed. Nothing failed, because a hard-coded sentence cannot
          disagree with anything — it just sat there being wrong while the
          policy moved underneath it.

          It now comes from `entitlement`, which is the server's own answer
          (`/api/ai/clean/entitlement` → `entitlementView`), so the screen and
          the reservation cannot drift apart again. Until that answer arrives —
          and for a member whose plan has no cap — the sentence says only what
          is true without a number in it.

          ⚠️ This matters beyond tidiness: an advertised allowance that the
          server does not honour is the kind of discrepancy an ad network reads
          as a misleading offer.
        */}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {!planKnown
            ? "AI Clean is included with Pro."
            : isPro
              ? paidAllowanceLine(entitlement)
              : freeAllowanceLine(entitlement)}
        </p>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className={cn(
              "group inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3.5",
              "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500",
              "text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)]",
              "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
              "disabled:opacity-70 disabled:hover:translate-y-0",
            )}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {busy ? "Starting…" : "Clean this video"}
          </button>

          <button type="button" onClick={onBack} disabled={busy} className="btn-lux btn-lux-secondary disabled:opacity-70">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The free-plan allowance, in words, from the server's own numbers.
 *
 * ── 🔴 EVERY BRANCH HERE EXISTS BECAUSE THE OLD SENTENCE HAD NONE ───────────
 *
 * The line it replaces was a single hard-coded string, which is why it could be
 * wrong in two ways at once and stay wrong for weeks. This says only what the
 * entitlement actually reports:
 *
 *   · no answer yet → no number, because a wrong number is worse than none;
 *   · unlimited or no cap → no number, because there isn't one;
 *   · a cap → that cap, pluralised;
 *   · and the ad clause appears ONLY when `rewardRequired` is true. The free
 *     plan currently sets `requiresReward: false`, so mentioning an ad gate
 *     would be warning somebody about a toll that was already removed.
 *
 * ⚠️ Wording, for the ad clause: "watch a short ad to unlock" — never anything
 * that asks somebody to CLICK or interact with an advertisement. That is an ad
 * network's line, not a stylistic preference, and the whole sentence is
 * generated here so there is one place it can be got right.
 */
/**
 * The same sentence for a paying member.
 *
 * ── 🔴 IT SAID "no daily cap", AND THERE IS ONE ─────────────────────────────
 *
 * `DEFAULT_BY_AUDIENCE.pro` is `dailyLimit: 10`. Business is 25, Max AI 40.
 * None of them were ever uncapped, so a Pro member could be told they had no
 * limit and then meet one on their eleventh video of the day. Only `unlimited`
 * may say so, and only the server may say `unlimited`.
 *
 * ── 🔴 AND THE NUMBER IS NOT PRINTED (owner, 2026-09-09) ────────────────────
 *
 * "those cap shouldn't be displayed cause it can be changed from the admin at
 * anytime."
 *
 * Right, and it is the stronger form of the same rule that fixed the free line.
 * A paid cap is an operator setting now, so printing it on this screen turns a
 * dashboard edit into a promise the product made and then quietly changed. The
 * remaining allowance is shown by `AICleanAllowance`, which re-reads it — a
 * live count is a fact, a printed ceiling is a claim.
 */
function paidAllowanceLine(entitlement: AiCleanEntitlement | null): string {
  return entitlement?.unlimited
    ? "Included with your plan — no ads, no daily cap."
    : "Included with your plan — no ads, and a bigger daily allowance.";
}

function freeAllowanceLine(entitlement: AiCleanEntitlement | null): string {
  const limit = entitlement?.dailyLimit ?? null;
  const capped = !entitlement?.unlimited && typeof limit === "number" && limit > 0;
  const reward = entitlement?.rewardRequired === true;

  if (!capped) {
    return reward
      ? "Watch a short ad to unlock each AI Clean video. Pro removes the ads."
      : "Pro adds a bigger daily allowance and faster processing.";
  }

  const videos = `${limit} AI Clean ${limit === 1 ? "video" : "videos"} a day`;
  return reward
    ? `Free members get ${videos}, each unlocked by watching a short ad. Pro removes both.`
    : `Free members get ${videos}. Pro adds a bigger allowance and faster processing.`;
}
