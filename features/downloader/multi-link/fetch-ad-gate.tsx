"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FullscreenInterstitial } from "@/features/monetization/fullscreen-interstitial";
import { useInterstitialConfig, useRewardNetwork } from "@/features/monetization/use-interstitial-skip";
import { useShowAds } from "@/features/monetization/use-show-ads";

/**
 * The skippable vignette shown once a fetch finishes and the results appear
 * (owner, 2026-08-25: "trigger on the multi links fetch so when is fetch a
 * skippable ad display like an interstitial (vignette) ad shows").
 *
 * ── ONE ad per fetch ACTION, not one per source ───────────────────────────
 * The trigger is the transition from "something is fetching" to "nothing is
 * fetching" — so "Fetch all" across three sources produces one ad, and a
 * single card's Fetch produces one ad. Firing per source would mean three
 * full-screen interruptions back to back for a single tap, which is both a
 * miserable experience and the kind of ad density that gets a site refused
 * (this project has three AdSense rejections behind it already — see
 * `youtube-removed-adsense`). The owner's ask is satisfied either way; this
 * is the reading that survives contact with a 3-source batch.
 *
 * ── It never blocks the results ───────────────────────────────────────────
 * The posts are already rendered underneath by the time this opens, and every
 * dead end fails OPEN — no creative, a slot that never answers, or a premium
 * viewer all simply close it. Nothing about a fetch depends on this resolving,
 * which is the difference between this and `BatchAdGate`: that one is paying
 * for a download, this one is an interruption placed after a completed action.
 */
export function FetchAdGate({
  /** True while ANY source is fetching. The falling edge is the trigger. */
  busy,
  /** How many sources have produced results — no ad if a fetch found nothing. */
  readyCount,
}: {
  busy: boolean;
  readyCount: number;
}) {
  const { showAds } = useShowAds();
  const { skipSeconds } = useInterstitialConfig();
  const { network } = useRewardNetwork("multilink_fetch");

  const [open, setOpen] = useState(false);
  // Null until the slot reports. `false` means "no creative".
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState(0);

  const wasBusy = useRef(false);
  const lastReadyCount = useRef(readyCount);

  const close = useCallback(() => {
    setOpen(false);
    setHasAd(null);
  }, []);

  // ── The falling edge of `busy` ─────────────────────────────────────────
  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!finished) return;

    // A fetch that produced nothing new (every source failed) gets no ad —
    // interrupting someone to show an ad on top of an error is the worst
    // possible moment for it.
    const gainedResults = readyCount > lastReadyCount.current;
    lastReadyCount.current = readyCount;
    if (!gainedResults) return;

    if (!showAds || network === "none") return;
    setHasAd(null);
    setRemaining(Math.max(0, skipSeconds));
    setOpen(true);
  }, [busy, readyCount, showAds, network, skipSeconds]);

  // Keep the baseline current even when no ad runs, so the NEXT fetch compares
  // against what is actually on screen rather than a stale count.
  useEffect(() => {
    if (!busy) lastReadyCount.current = readyCount;
  }, [busy, readyCount]);

  // ── Skip countdown ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || remaining <= 0) return;
    const id = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [open, remaining]);

  /*
    No creative, or a slot that never answers at all — close on its own.
    An "advertisement unavailable" dead end over results the visitor can
    already see would be pure obstruction.
  */
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      if (hasAd !== true) close();
    }, hasAd === false ? 900 : 2500);
    return () => clearTimeout(id);
  }, [open, hasAd, close]);

  if (!open) return null;

  return (
    <FullscreenInterstitial
      zone="multilink_fetch_gate"
      /* `=== true`, never `!== false`: `hasAd` is three-state, and testing
         "not false" would flash the interstitial before the slot has
         reported anything. */
      shown={hasAd === true}
      canSkip={remaining <= 0}
      remaining={remaining}
      onResolved={setHasAd}
      onClose={() => {
        if (remaining <= 0) close();
      }}
      upsell={{ text: "Fetching a lot? Skip these.", cta: "Go Pro", href: "/pricing" }}
    />
  );
}
