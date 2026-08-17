"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FullscreenInterstitial } from "@/features/monetization/fullscreen-interstitial";
import { useInterstitialConfig } from "@/features/monetization/use-interstitial-skip";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { useRewardSession, type RewardSessionItem } from "@/features/monetization/use-reward-session";
import { dismissToast, toast } from "@/features/ui/toast";

/** Fixed id so opening a new gate can never stack a second "Preparing…" toast
 *  on top of one already showing, and so it can be found and dismissed from
 *  anywhere the gate resolves. */
const PREP_TOAST_ID = "batch-ad-gate-prep";

export interface BatchAuthorization {
  rewardSessionId: string;
  items: RewardSessionItem[];
}

/**
 * Batch downloads: free, paid for by an ad before the batch runs and a short
 * one after it finishes.
 *
 * ── Why this replaced the Pro wall ───────────────────────────────────────
 * Batch used to be a Pro gate. An upgrade prompt earns nothing from the
 * overwhelming majority who will never buy — it just removes the feature and
 * leaves a bad taste. An ad earns something from all of them AND lets them
 * have the thing they came for. Pro and Business skip both ads, which is
 * exactly what they are paying for.
 *
 * ── 🔴 Server-verified when there IS an ad; never a dead end when there
 *    isn't (owner, 2026-08-16, first the "secure, production-ready
 *    rewarded-ad system" spec, then a direct correction the same day) ────
 * An ad that genuinely rendered and ran its FULL course (the skip control
 * stays hidden — see `canSkip={remaining <= 0}` below — until the countdown
 * finishes, so "resolved" only ever means "watched completely") goes through
 * a server-side reward session (`lib/monetization/reward-sessions.ts`)
 * before `onProceed` fires.
 *
 * This USED to also block the batch outright — "Advertisement unavailable",
 * dead end, Try Again only — whenever no ad loaded at all. The owner
 * corrected that: no ad inventory is not the visitor's problem to solve, so
 * every "there's simply nothing to show" path (the slot never answers, it
 * answers with no creative, or the reward confirmation itself fails after an
 * ad that already ran its course) now fails OPEN — `onProceed(null)`, the
 * same signal already used for Pro/Business and "feature switched off". The
 * one thing that never changes is the other half: whenever an ad IS
 * available, it must be watched in full before anything is granted.
 */
export function BatchAdGate({
  /*
    🔴 The ARRAY, not a derived boolean (owner, 2026-08-16: "the glitch that
    suddenly stops free users who multi download… the download button does
    nothing… before it was working and it stopped").

    This used to be `pending: boolean`, and the caller passed
    `pendingBatch !== null`. That is the whole bug: React re-runs an effect
    when a DEPENDENCY changes, and a boolean that is already `true` does not
    change just because the thing behind it did. Passing the array itself
    (a fresh, memoised object only when the underlying request actually
    changes — see the caller) and keying the effect on THAT reference is what
    makes every distinct batch request a genuinely distinct dependency.
  */
  batch,
  onProceed,
  /** Set once a batch has finished, to run the short closing ad. */
  showComplete,
  onCompleteClosed,
}: {
  batch: readonly RewardSessionItem[] | null;
  onProceed: (auth: BatchAuthorization | null) => void;
  showComplete: boolean;
  onCompleteClosed: () => void;
}) {
  const { showAds } = useShowAds();
  const { batchDownload: enabled, batchGateSeconds, batchCompleteSeconds } = useInterstitialConfig();
  const { start, complete } = useRewardSession();

  const [phase, setPhase] = useState<"idle" | "gate" | "complete">("idle");
  const [remaining, setRemaining] = useState(0);
  // Null until the slot reports. `false` means "no creative".
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const proceeded = useRef(false);
  // Opened in parallel with the ad UI (Part 9: session created BEFORE the ad
  // is shown) so `grant()` almost never has to wait on it — a real ad takes
  // seconds to watch/skip, a session-start round trip takes a fraction of one.
  const startPromiseRef = useRef<ReturnType<typeof start> | null>(null);

  const bypass = useCallback(
    (slow?: boolean) => {
      if (proceeded.current) return;
      proceeded.current = true;
      setPhase("idle");
      dismissToast(PREP_TOAST_ID);
      if (slow) toast("Slow connection — continuing without the ad", "info", { duration: 3500 });
      onProceed(null);
    },
    [onProceed],
  );

  /** The ad rendered and ran its FULL course (see `canSkip` below — this is
   *  only reachable once the countdown hit zero) — confirm the reward and
   *  grant. If the confirmation call itself fails, the ad has already been
   *  watched in full by this point, so the fair outcome is to let the batch
   *  through anyway rather than deny a download that was already earned. */
  const grant = useCallback(async () => {
    if (proceeded.current || !batch) return;
    proceeded.current = true;
    setPhase("idle");
    dismissToast(PREP_TOAST_ID);
    try {
      const session = await (startPromiseRef.current ?? start("batch", [...batch]));
      const result = await complete("batch", session.rewardSessionId);
      onProceed({ rewardSessionId: session.rewardSessionId, items: result.items });
    } catch (e) {
      console.warn("[batch-ad-gate] reward confirmation failed after a completed ad, proceeding anyway:", e);
      onProceed(null);
    }
  }, [batch, start, complete, onProceed]);

  // ── Open the gate ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!batch) return;
    proceeded.current = false;

    // Premium members, or the feature switched off: straight through, no
    // reward session at all.
    if (!showAds || !enabled) {
      bypass();
      return;
    }
    startPromiseRef.current = start("batch", [...batch]);
    setHasAd(null);
    setRemaining(Math.max(0, batchGateSeconds));
    setPhase("gate");
    // Immediate feedback the instant the tap registers.
    toast("Preparing your download…", "loading", { id: PREP_TOAST_ID });
  }, [batch, showAds, enabled, batchGateSeconds, bypass, start]);

  /*
    Ceiling for a slot that never answers at all (`hasAd` stuck at `null`).
    Fails OPEN (owner, 2026-08-16: "shouldnt stop download when there are no
    ad") — no creative ever confirmed means there was never anything to
    watch, so the batch just runs rather than dead-ending on "Advertisement
    unavailable".
  */
  useEffect(() => {
    if (phase !== "gate" || hasAd !== null) return;
    const id = setTimeout(() => {
      if (phase === "gate" && hasAd === null) bypass(true);
    }, 2500);
    return () => clearTimeout(id);
  }, [phase, hasAd, bypass]);

  // ── The closing ad ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!showComplete) return;
    if (!showAds || !enabled) {
      onCompleteClosed();
      return;
    }
    setHasAd(null);
    setRemaining(Math.max(0, batchCompleteSeconds));
    setPhase("complete");
  }, [showComplete, showAds, enabled, batchCompleteSeconds, onCompleteClosed]);

  // ── Countdown ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "idle" || remaining <= 0) return;
    const id = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, remaining]);

  /*
    No creative → same fail-open rule as the ceiling above, for the GATE. The
    purely cosmetic CLOSING ad — which runs after the batch has already
    succeeded — has no grant decision to make either way, so it simply closes.
  */
  useEffect(() => {
    if (phase === "idle") return;
    const id = setTimeout(() => {
      if (hasAd === false) {
        if (phase === "gate") bypass();
        else {
          setPhase("idle");
          onCompleteClosed();
        }
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [phase, hasAd, bypass, onCompleteClosed]);

  const close = useCallback(() => {
    if (phase === "gate") void grant();
    else {
      setPhase("idle");
      onCompleteClosed();
    }
  }, [phase, grant, onCompleteClosed]);

  if (phase === "idle") return null;

  const isGate = phase === "gate";
  return (
    <FullscreenInterstitial
      zone={isGate ? "batch_download_gate" : "batch_download_complete"}
      /*
        ── `=== true`, NEVER `!== false` (owner, 2026-08-09) ─────────────────
        `hasAd` is THREE-STATE: `null` = the slot has not answered yet, `false`
        = no creative, `true` = a creative is there. Testing "not false" would
        reveal the interstitial on the very first frame, before the slot has
        reported anything.
      */
      shown={hasAd === true}
      canSkip={remaining <= 0}
      remaining={remaining}
      onResolved={setHasAd}
      onClose={() => {
        if (remaining <= 0) close();
      }}
      upsell={{
        text: isGate ? "Downloading a lot? Skip these." : "Skip the ads next time.",
        cta: "Go Pro",
        href: "/pricing",
      }}
    />
  );
}

export type BatchAdGateProps = Parameters<typeof BatchAdGate>[0];
