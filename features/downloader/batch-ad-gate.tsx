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
 * ── 🔴 Now server-verified (owner, 2026-08-16 spec: "secure, production-ready
 *    rewarded-ad system") ─────────────────────────────────────────────────
 * This used to grant the batch on nothing more than "a creative rendered" —
 * existence, not completion — and even THAT was skipped if the ad slot was
 * simply slow to answer. That is real ground given up here: an ad that
 * genuinely rendered and ran its course now goes through a server-side
 * reward session (`lib/monetization/reward-sessions.ts`) before `onProceed`
 * fires, and — this is the real behaviour change — an ad that never loads no
 * longer lets the batch through anyway. It shows "Advertisement unavailable"
 * instead. The ad UI/timing itself (skip countdown, upsell) is UNCHANGED;
 * only what happens once it resolves is different.
 *
 * `onProceed(null)` still means "bypass — no reward session at all", for the
 * two cases that never depended on an ad in the first place: Pro/Business, or
 * the feature switched off in the admin. Neither of those can get stuck,
 * because neither of them touches the async ad-slot fetch at all.
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
  onCancel,
  /** Set once a batch has finished, to run the short closing ad. */
  showComplete,
  onCompleteClosed,
}: {
  batch: readonly RewardSessionItem[] | null;
  onProceed: (auth: BatchAuthorization | null) => void;
  onCancel: () => void;
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
  // The ad genuinely never became available (Part 16/18) — a distinct dead
  // end from "idle", with its own explicit "Try Again".
  const [unavailable, setUnavailable] = useState(false);
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

  const markUnavailable = useCallback(() => {
    if (proceeded.current) return;
    proceeded.current = true;
    setPhase("idle");
    dismissToast(PREP_TOAST_ID);
    setUnavailable(true);
  }, []);

  /** The ad rendered and ran its course — confirm the reward before granting. */
  const grant = useCallback(async () => {
    if (proceeded.current || !batch) return;
    proceeded.current = true;
    setPhase("idle");
    dismissToast(PREP_TOAST_ID);
    try {
      const session = await (startPromiseRef.current ?? start("batch", [...batch]));
      const result = await complete("batch", session.rewardSessionId);
      onProceed({ rewardSessionId: session.rewardSessionId, items: result.items });
    } catch {
      setUnavailable(true);
    }
  }, [batch, start, complete, onProceed]);

  const tryAgain = useCallback(() => {
    setUnavailable(false);
    onCancel();
  }, [onCancel]);

  // ── Open the gate ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!batch) return;
    proceeded.current = false;
    setUnavailable(false);

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
    Unlike before, this no longer proceeds — no creative ever confirmed means
    there's nothing to have watched, so it's treated as unavailable rather
    than let through silently.
  */
  useEffect(() => {
    if (phase !== "gate" || hasAd !== null) return;
    const id = setTimeout(() => {
      if (phase === "gate" && hasAd === null) markUnavailable();
    }, 2500);
    return () => clearTimeout(id);
  }, [phase, hasAd, markUnavailable]);

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
    No creative → for the GATE, this is now "unavailable" (see above). For the
    purely cosmetic CLOSING ad — which runs after the batch has already
    succeeded — there is no grant decision to make either way, so it simply
    closes.
  */
  useEffect(() => {
    if (phase === "idle") return;
    const id = setTimeout(() => {
      if (hasAd === false) {
        if (phase === "gate") markUnavailable();
        else {
          setPhase("idle");
          onCompleteClosed();
        }
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [phase, hasAd, markUnavailable, onCompleteClosed]);

  const close = useCallback(() => {
    if (phase === "gate") void grant();
    else {
      setPhase("idle");
      onCompleteClosed();
    }
  }, [phase, grant, onCompleteClosed]);

  if (unavailable) {
    return (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl bg-card p-6 text-center shadow-luxury">
          <p className="text-base font-bold">Advertisement unavailable</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We couldn't load a rewarded ad right now. Please try again.
          </p>
          <button
            type="button"
            onClick={tryAgain}
            className="mt-4 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition active:scale-[0.98]"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

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

/** Cancel is exposed for callers that need to abandon a pending batch. */
export type BatchAdGateProps = Parameters<typeof BatchAdGate>[0];
