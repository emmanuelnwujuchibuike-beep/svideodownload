"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FullscreenInterstitial } from "@/features/monetization/fullscreen-interstitial";
import { useInterstitialConfig } from "@/features/monetization/use-interstitial-skip";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { dismissToast, toast } from "@/features/ui/toast";

/** Fixed id so opening a new gate can never stack a second "Preparing…" toast
 *  on top of one already showing, and so it can be found and dismissed from
 *  anywhere the gate resolves. */
const PREP_TOAST_ID = "batch-ad-gate-prep";

/**
 * Batch downloads: free, paid for by an ad (owner, 2026-08-09).
 *
 * ── Why this replaced the Pro wall ───────────────────────────────────────
 * Batch used to be a Pro gate. An upgrade prompt earns nothing from the
 * overwhelming majority who will never buy — it just removes the feature and
 * leaves a bad taste. An ad earns something from all of them AND lets them
 * have the thing they came for. Pro and Business skip both ads, which is
 * exactly what they are paying for.
 *
 * ── The download is never held hostage ───────────────────────────────────
 * Three rules make that true, and all three matter:
 *
 *  1. If the slot has no creative, the batch RUNS. A placement that failed to
 *     fill must never block a download — the member did nothing wrong and has
 *     no way to fix it.
 *  2. The "after" ad fires once the files are already saved, so dismissing it
 *     can never cost anything.
 *  3. If the config never loads, batching is simply free. A failed fetch gives
 *     the feature away rather than showing an ad nobody configured.
 *
 * ── Why a countdown and not a rewarded unit ──────────────────────────────
 * A rewarded ad requires watching to completion, and a batch is not a big
 * enough ask to justify holding someone's download until an ad server says
 * they may proceed. A skip countdown is the honest version of the same trade:
 * a fixed, visible price, after which they are in control again.
 */
export function BatchAdGate({
  /*
    🔴 The ARRAY, not a derived boolean (owner, 2026-08-16: "the glitch that
    suddenly stops free users who multi download… the download button does
    nothing… before it was working and it stopped").

    This used to be `pending: boolean`, and the caller passed
    `pendingBatch !== null`. That is the whole bug: React re-runs an effect
    when a DEPENDENCY changes, and a boolean that is already `true` does not
    change just because the thing behind it did. If the ad slot for one batch
    ever got stuck reporting neither "has a creative" nor "definitely doesn't"
    (`hasAd` staying `null` — a slow/stalled `/api/ads` fetch, no timeout on
    it), the gate never resolved, `pendingBatch` never got cleared back to
    `null`, and `pending` sat at `true` forever. Every batch attempt after
    that sets `pendingBatch` to a NEW array — but `pendingBatch !== null` is
    STILL `true`, unchanged, so the "open the gate" effect below never fires
    again for the rest of the session: exactly "does nothing", and exactly
    "before it was working and it stopped" once one request happened to hang.

    Free-only because Pro/Business never depend on the async ad fetch at
    all — `!showAds` short-circuits to `runNow()` synchronously in the same
    effect run, so there is nothing there that CAN get stuck.

    Passing the array itself (a fresh object on every `setPendingBatch` call,
    even for a re-selection of the same items) and keying the effect on THAT
    reference — not a boolean summary of it — means every distinct batch
    request is a genuinely distinct dependency, so it can never be silently
    absorbed into an already-`true` flag again.
  */
  batch,
  onProceed,
  onCancel,
  /** Set once a batch has finished, to run the short closing ad. */
  showComplete,
  onCompleteClosed,
}: {
  batch: readonly unknown[] | null;
  onProceed: () => void;
  onCancel: () => void;
  showComplete: boolean;
  onCompleteClosed: () => void;
}) {
  const { showAds } = useShowAds();
  const { batchDownload: enabled, batchGateSeconds, batchCompleteSeconds } = useInterstitialConfig();

  const [phase, setPhase] = useState<"idle" | "gate" | "complete">("idle");
  const [remaining, setRemaining] = useState(0);
  // Null until the slot reports. `false` means "no creative" — the batch runs.
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const proceeded = useRef(false);

  /*
    🔴 "sometimes it works" (owner, 2026-08-16) — the missing piece was never
    the LOGIC, it was that nothing on screen said anything was happening while
    the ad slot resolved. `FullscreenInterstitial` correctly renders itself
    invisible AND non-blocking while `hasAd` is still `null` (right — a hidden
    ad must never eat a tap), but that also means a visitor on a slow
    connection sees a dead screen for as long as the fetch takes, which reads
    exactly like "the button does nothing" even though the code is working
    its way through the gate correctly. `runNow`'s `slow` flag distinguishes
    "resolved normally" from "gave up waiting" so only the second case says
    anything — the happy path (ad shown, or a fast confirmed no-fill) stays
    silent, as it always has.
  */
  const runNow = useCallback(
    (slow?: boolean) => {
      if (proceeded.current) return;
      proceeded.current = true;
      setPhase("idle");
      dismissToast(PREP_TOAST_ID);
      if (slow) toast("Slow connection — continuing without the ad", "info", { duration: 3500 });
      onProceed();
    },
    [onProceed],
  );

  // ── Open the gate ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!batch) return;
    proceeded.current = false;

    // Premium members, or the feature switched off: straight through.
    if (!showAds || !enabled) {
      runNow();
      return;
    }
    setHasAd(null);
    setRemaining(Math.max(0, batchGateSeconds));
    setPhase("gate");
    // Immediate feedback the instant the tap registers — see the note on
    // `runNow` above for why a silent wait was the actual "does nothing" bug.
    // A `loading` toast has no auto-dismiss timer, so it sits exactly as long
    // as the gate takes and is always explicitly cleared in `runNow`.
    toast("Preparing your download…", "loading", { id: PREP_TOAST_ID });
    // `batch` (the array reference), not a derived boolean — see the prop
    // comment above for why that distinction is the entire fix.
  }, [batch, showAds, enabled, batchGateSeconds, runNow]);

  /*
    🔴 THE CEILING (belt, to the reference-dependency fix's braces). Even with
    the dependency bug fixed, nothing before this stopped `hasAd` itself from
    hanging at `null` indefinitely if `/api/ads` never resolves at all — the
    existing 1200ms grace check only acts when `hasAd === false`, never when
    it's still `null`.

    🔴 SHORTENED 6000ms → 2500ms same day ("sometimes it works… poor
    network?"). 6s generously covers real ad-fill latency, but it also means
    up to 6 FULL SECONDS of the dead-silent screen described above on
    anything slower than a great connection — long past when a visitor
    reasonably concludes the tap didn't register and gives up. 2.5s is still
    well past a normal ad response and short enough that, paired with the
    "Preparing…" toast above, a slow attempt now reads as "this is taking a
    moment" instead of "this is broken". Past it, treat the slot exactly like
    a confirmed no-fill and let the batch through — the standing rule this
    whole component is built on is that a placement failing to load must
    never hold a download hostage.
  */
  useEffect(() => {
    if (phase !== "gate" || hasAd !== null) return;
    const id = setTimeout(() => {
      if (phase === "gate" && hasAd === null) runNow(true);
    }, 2500);
    return () => clearTimeout(id);
  }, [phase, hasAd, runNow]);

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
    No creative → do not hold anything up.

    A short grace period first: the slot reports `false` before a network-filled
    unit has had any chance, so acting on the first frame would skip the ad on
    every slow connection and lose the revenue this feature exists for.
  */
  useEffect(() => {
    if (phase === "idle") return;
    const id = setTimeout(() => {
      if (hasAd === false) {
        if (phase === "gate") runNow();
        else {
          setPhase("idle");
          onCompleteClosed();
        }
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [phase, hasAd, runNow, onCompleteClosed]);

  const close = useCallback(() => {
    if (phase === "gate") runNow();
    else {
      setPhase("idle");
      onCompleteClosed();
    }
  }, [phase, runNow, onCompleteClosed]);

  if (phase === "idle") return null;

  const isGate = phase === "gate";
  return (
    <FullscreenInterstitial
      zone={isGate ? "batch_download_gate" : "batch_download_complete"}
      /*
        ── `=== true`, NEVER `!== false` (owner, 2026-08-09) ─────────────────
        "the black flashing and showing when a multiple download is selected."

        `hasAd` is THREE-STATE: `null` = the slot has not answered yet, `false`
        = no creative, `true` = a creative is there. This used to test "not
        false", and NULL IS NOT FALSE — so the interstitial was revealed on the
        very first frame of every batch, before the slot had reported anything.

        `FullscreenInterstitial` is an OPAQUE `fixed inset-0 bg-black`. So each
        batch put a full-screen black panel over the page with nothing on it,
        held it for at least the 1200 ms grace period, and then either filled it
        or tore it down — which is exactly the flash being reported. It is
        specific to multiple downloads because this component only runs for a
        batch.

        `=== true` waits for a positive answer, which is what the sibling
        `DownloadInterstitial` has always done (`open && hasAd === true`). The
        slot still loads while hidden — the shell keeps it mounted and merely
        `hidden` — so nothing about fill or reporting changes, and the
        no-creative path below still lets the batch run.
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
