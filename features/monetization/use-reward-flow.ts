"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RewardSurfaceTag, RewardType } from "@/lib/monetization/reward-sessions";

import { useGptRewardedAd } from "./use-gpt-rewarded-ad";
import { RewardSessionClientError, useRewardSession, type RewardSessionItem } from "./use-reward-session";

/**
 * The two reward-gated features (owner, 2026-08-16 GPT spec, §4): unlocking a
 * download, and previewing an already-downloaded video. Deliberately never
 * chained — see `use-reward-flow.ts`'s own doc below for why.
 */
export type RewardFlowContext = "DOWNLOAD_UNLOCK" | "VIDEO_PREVIEW" | "BATCH_UNLOCK";

/**
 * Defaults to Google's own public TEST rewarded ad unit — real Google-served
 * creative, real `rewardedSlotReady`/`rewardedSlotGranted` events, zero
 * revenue — verified from Google's current official sample
 * (`googleads/google-publisher-tag-samples`). This repo has no Google Ad
 * Manager account configured yet; set `NEXT_PUBLIC_GPT_REWARDED_AD_UNIT_PATH`
 * to a real "/networkCode/adUnitName" once one exists. Until then, the whole
 * flow below is genuinely functional end to end, just against test inventory.
 */
const DEFAULT_AD_UNIT_PATH =
  process.env.NEXT_PUBLIC_GPT_REWARDED_AD_UNIT_PATH || "/22639388115/rewarded_web_example";

const CONTEXT_META: Record<
  RewardFlowContext,
  {
    type: RewardType;
    /** Reporting tag for the reward session — overridable, because
     *  BATCH_UNLOCK is opened by BOTH the single-link and multi-link gates. */
    surface: RewardSurfaceTag;
    title: string;
    body: string;
    primaryLabel: string;
    secondaryLabel: string;
    declinedMessage: string;
  }
> = {
  DOWNLOAD_UNLOCK: {
    type: "hd",
    surface: "hd_download",
    title: "Unlock your download",
    body: "Watch a short sponsored experience to unlock this download for free.",
    primaryLabel: "Watch & Download",
    secondaryLabel: "Not now",
    declinedMessage: "Download wasn't unlocked because the ad wasn't completed.",
  },
  VIDEO_PREVIEW: {
    type: "preview",
    surface: "video_preview",
    title: "Preview this video",
    body: "Watch a short sponsored experience to unlock the video preview.",
    primaryLabel: "Watch & Preview",
    secondaryLabel: "Cancel",
    declinedMessage: "The preview wasn't unlocked because the ad wasn't completed.",
  },
  /*
    Added 2026-08-25 so a batch gate can run the real GPT rewarded flow when an
    admin routes it there (lib/monetization/reward-networks.ts), instead of the
    zone-based interstitial.

    It reuses `type: "batch"` — the SAME reward-session type the interstitial
    path already opens — so the server side is entirely unchanged: same
    `MAX_ITEMS.batch` cap, same daily limit field, same `redeemRewardItem`
    substitution at download time. Only the thing the visitor watches differs.
  */
  BATCH_UNLOCK: {
    type: "batch",
    surface: "batch_download",
    title: "Unlock your batch download",
    body: "Watch a short sponsored experience to download everything you selected.",
    primaryLabel: "Watch & Download",
    secondaryLabel: "Not now",
    declinedMessage: "The batch wasn't unlocked because the ad wasn't completed.",
  },
};

type Phase = "closed" | "prompt" | "requesting" | "unavailable" | "declined" | "completing" | "failed";

export interface RewardConsentSheetProps {
  open: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  busy: boolean;
  statusText: string | null;
  errorText: string | null;
}

/**
 * Orchestrates one reward context end to end: consent → server session
 * (`use-reward-session.ts`, unchanged from last session) → real GPT ad
 * (`use-gpt-rewarded-ad.ts`) → grant → server-side completion → the caller's
 * `onGranted`. This is the ONLY place that decides when a GPT ad is
 * requested or shown; `preview-card.tsx` and `floating-progress.tsx` each
 * just call `open(items)` and render the returned `sheetProps`.
 *
 * ── Never auto-chained (§16) ───────────────────────────────────────────────────
 * Each `useRewardFlow` instance is scoped to ONE context. Nothing here ever
 * opens a second context's flow — `VIDEO_PREVIEW` is only ever entered from a
 * wholly separate, later user tap ("Review video"), never from this hook's
 * own grant/close handlers.
 */
export function useRewardFlow(
  context: RewardFlowContext,
  onGranted: (items: RewardSessionItem[], rewardSessionId: string) => void,
  /**
   * Per-surface GPT ad unit (`/networkCode/adUnitName`), from the admin's
   * reward-network table. Empty/omitted keeps the global default.
   *
   * Per surface rather than one path for the whole site because that is the
   * only way a Google Ad Manager report can say whether the multi-link gate or
   * the HD gate earned the money — one shared unit reports them as one number.
   */
  adUnitPath?: string,
  /** Overrides the context default — BATCH_UNLOCK is opened by two different
   *  gates and the admin needs to tell their revenue apart. */
  surfaceTag?: RewardSurfaceTag,
) {
  const meta = CONTEXT_META[context];
  const { start, complete } = useRewardSession();
  const gpt = useGptRewardedAd();
  const [phase, setPhase] = useState<Phase>("closed");
  const [errorText, setErrorText] = useState<string | null>(null);
  const itemsRef = useRef<RewardSessionItem[]>([]);
  const startPromiseRef = useRef<ReturnType<typeof start> | null>(null);
  const grantedHandledRef = useRef(false);

  const open = useCallback(
    (items: RewardSessionItem[]) => {
      itemsRef.current = items;
      grantedHandledRef.current = false;
      startPromiseRef.current = null;
      setErrorText(null);
      gpt.reset();
      setPhase("prompt");
    },
    [gpt],
  );

  const cancel = useCallback(() => {
    gpt.reset();
    setPhase("closed");
  }, [gpt]);

  /** The only place `useGptRewardedAd().request()` is called — always from an
   *  explicit tap on "Watch & …" (the initial prompt) or "Try Again" (a
   *  dead-end state), never automatically. */
  const watch = useCallback(() => {
    setErrorText(null);
    setPhase("requesting");
    grantedHandledRef.current = false;
    const promise = start(meta.type, itemsRef.current, surfaceTag ?? meta.surface);
    startPromiseRef.current = promise;
    promise.catch((e) => {
      if (startPromiseRef.current !== promise) return; // superseded by a newer attempt
      gpt.reset();
      setErrorText(e instanceof RewardSessionClientError ? e.message : "Reward unavailable. Please try again in a moment.");
      setPhase("unavailable");
    });
    gpt.request(adUnitPath?.trim() || DEFAULT_AD_UNIT_PATH);
  }, [start, meta.type, meta.surface, surfaceTag, gpt, adUnitPath]);

  // GPT slot ready → show it immediately. Consent was already collected at
  // the prompt step; this is not a second opt-in, just the earliest moment
  // it's technically possible to display the ad Google already agreed to
  // grant a reward for.
  useEffect(() => {
    if (phase === "requesting" && gpt.state === "reward_ready") gpt.show();
  }, [phase, gpt]);

  useEffect(() => {
    if (phase === "requesting" && gpt.state === "reward_failed") {
      setErrorText("We couldn't load a rewarded ad right now. Please try again.");
      setPhase("unavailable");
    }
  }, [phase, gpt.state]);

  useEffect(() => {
    if (phase === "requesting" && gpt.state === "reward_closed") {
      setPhase("declined");
    }
  }, [phase, gpt.state]);

  // The only path that unlocks anything: rewardedSlotGranted, guarded against
  // firing twice (§5 idempotency).
  useEffect(() => {
    if (gpt.state !== "reward_granted" || grantedHandledRef.current) return;
    grantedHandledRef.current = true;
    setPhase("completing");
    void (async () => {
      try {
        const startPromise = startPromiseRef.current;
        if (!startPromise) throw new RewardSessionClientError("INVALID_REQUEST", "Reward session was never started.");
        const session = await startPromise;
        const result = await complete(meta.type, session.rewardSessionId);
        onGranted(result.items, session.rewardSessionId);
        gpt.reset();
        setPhase("closed");
      } catch (e) {
        setErrorText(
          e instanceof RewardSessionClientError ? e.message : "Couldn't confirm your reward. Please try again.",
        );
        setPhase("failed");
      }
    })();
  }, [gpt, complete, meta.type, onGranted]);

  useEffect(() => cancel, [cancel]);

  const busy = phase === "requesting" || phase === "completing";
  // Hidden entirely while Google's own ad UI is on screen — nothing
  // Frenzsave-owned may sit over it (§18/§24).
  const sheetOpen = phase !== "closed" && gpt.state !== "reward_showing";
  const isDeadEnd = phase === "unavailable" || phase === "declined" || phase === "failed";

  const sheetProps: RewardConsentSheetProps = {
    open: sheetOpen,
    title: meta.title,
    body: phase === "declined" ? meta.declinedMessage : meta.body,
    primaryLabel: isDeadEnd ? "Try Again" : meta.primaryLabel,
    secondaryLabel: meta.secondaryLabel,
    onPrimary: isDeadEnd || phase === "prompt" ? watch : () => {},
    onSecondary: cancel,
    busy,
    statusText: busy ? "Loading…" : null,
    errorText,
  };

  return { open, cancel, sheetProps };
}
