"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A real Google Publisher Tag (GPT) rewarded-ad slot, owned end to end by
 * this hook. Nothing else in the app talks to `googletag` directly.
 *
 * ── Why this exists (owner, 2026-08-16 spec) ──────────────────────────────────
 * No GPT integration existed anywhere in this repo before — every prior
 * "reward ad" was an admin-uploaded video played in a plain `<video>` tag, or
 * a wall-clock timer. This is the real thing: `defineOutOfPageSlot` with
 * `OutOfPageFormat.REWARDED`, and the three events Google's own API defines
 * for it. The API shape below is verified against Google's current official
 * sample (`googleads/google-publisher-tag-samples`, `display-rewarded-ad`),
 * not guessed.
 *
 * ── The one rule that matters most ────────────────────────────────────────────
 * `makeRewardedVisible()` — the only thing that actually puts Google's ad UI
 * on screen — is captured from the `rewardedSlotReady` event and exposed ONLY
 * through this hook's `show()`. Nothing calls it automatically. The caller
 * (`use-reward-flow.ts`) only ever calls `show()` from a user's own tap on a
 * Frenzsave-owned "Watch & …" button.
 *
 * `rewardedSlotGranted` is the ONLY event that means a reward was earned.
 * `rewardedSlotClosed` never is — closing before granted resolves to
 * `reward_closed`, not a reward.
 */

export type GptRewardState =
  | "idle"
  | "reward_loading"
  | "reward_ready"
  | "reward_showing"
  | "reward_granted"
  | "reward_closed"
  | "reward_failed";

interface GptEvent {
  slot?: unknown;
}
interface GptSlotReadyEvent extends GptEvent {
  makeRewardedVisible: () => void;
}
interface GptSlotGrantedEvent extends GptEvent {
  payload: { name: string; amount: number } | null;
}
interface GptSlotRenderEndedEvent extends GptEvent {
  isEmpty: boolean;
}
interface GptSlot {
  addService: (service: GptPubAdsService) => GptSlot;
}
interface GptPubAdsService {
  addEventListener: (type: string, listener: (event: never) => void) => GptPubAdsService;
  removeEventListener: (type: string, listener: (event: never) => void) => GptPubAdsService;
}
interface GoogletagApi {
  cmd: { push: (fn: () => void) => void };
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  pubads: () => GptPubAdsService;
  defineOutOfPageSlot: (adUnitPath: string, format: unknown) => GptSlot | null;
  enableServices: () => void;
  display: (slot: GptSlot) => void;
  destroySlots: (slots: GptSlot[]) => void;
}
declare global {
  interface Window {
    googletag?: GoogletagApi & { cmd: { push: (fn: () => void) => void } };
  }
}

const GPT_SCRIPT_SRC = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
let gptLoadPromise: Promise<void> | null = null;

/** Loads gpt.js at most once per page, however many rewarded flows run. */
function loadGpt(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  window.googletag = window.googletag || ({ cmd: [] } as unknown as GoogletagApi);
  if (gptLoadPromise) return gptLoadPromise;
  gptLoadPromise = new Promise((resolve) => {
    if (document.querySelector(`script[src="${GPT_SCRIPT_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = GPT_SCRIPT_SRC;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    // A network failure loading gpt.js itself surfaces as the slot never
    // becoming ready — `request()`'s own timeout below handles it as
    // `reward_failed` rather than hanging forever.
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return gptLoadPromise;
}

/** No two rewarded slots active at once, regardless of which component asked —
 *  defense in depth alongside whatever the caller already enforces (spec §17). */
let activeToken: symbol | null = null;

const READY_TIMEOUT_MS = 10_000;

export function useGptRewardedAd() {
  const [state, setStateRaw] = useState<GptRewardState>("idle");
  // Mirrors `state` for code that needs the CURRENT value inside a callback
  // registered long before it runs (the ready-timeout below) — `state` itself
  // is only ever the value from the render that created the closure.
  const stateRef = useRef<GptRewardState>("idle");
  const setState = useCallback((next: GptRewardState | ((prev: GptRewardState) => GptRewardState)) => {
    setStateRaw((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      stateRef.current = resolved;
      return resolved;
    });
  }, []);
  const slotRef = useRef<GptSlot | null>(null);
  const makeVisibleRef = useRef<(() => void) | null>(null);
  const grantedRef = useRef(false);
  const tokenRef = useRef<symbol | null>(null);
  const listenersRef = useRef<Array<{ type: string; fn: (event: never) => void }>>([]);

  /*
    🔴 Releases the module-level "one slot at a time" lock (fixed 2026-08-16:
    "the download button flashes once, then does nothing on every click
    after"). Every terminal-failure path below (no slot returned, the
    ready-timeout, an empty render, the user closing the ad) called
    `setState(...)` directly without going through this — so the very FIRST
    failed attempt (extremely likely in practice: rewarded out-of-page ads
    have real device/page eligibility requirements Google enforces, and the
    fallback public test ad unit won't reliably fill in every browsing
    context) left `activeToken` permanently set. `watch()` in
    use-reward-flow.ts's retry ("Try Again") calls `request()` directly, not
    `reset()`, so `request()`'s own `if (activeToken !== null) return;` guard
    then silently no-ops on every later click, forever — exactly the
    reported symptom. This is now called at every terminal transition, not
    only on a fresh `reset()`.
  */
  const releaseToken = useCallback((token: symbol) => {
    if (activeToken === token) activeToken = null;
  }, []);

  const destroy = useCallback(() => {
    if (tokenRef.current) releaseToken(tokenRef.current);
    tokenRef.current = null;
    const gt = typeof window !== "undefined" ? window.googletag : undefined;
    if (gt?.pubads) {
      const pubads = gt.pubads();
      for (const { type, fn } of listenersRef.current) pubads.removeEventListener(type, fn);
    }
    listenersRef.current = [];
    if (slotRef.current && gt?.destroySlots) {
      gt.cmd.push(() => gt.destroySlots([slotRef.current!]));
    }
    slotRef.current = null;
    makeVisibleRef.current = null;
    grantedRef.current = false;
  }, [releaseToken]);

  useEffect(() => destroy, [destroy]);

  const request = useCallback(
    (adUnitPath: string) => {
      if (activeToken !== null) return; // one at a time, repo-wide
      destroy();
      const token = Symbol("gpt-rewarded");
      tokenRef.current = token;
      activeToken = token;
      setState("reward_loading");

      const timeout = setTimeout(() => {
        if (tokenRef.current === token && stateRef.current !== "reward_ready" && stateRef.current !== "reward_granted") {
          releaseToken(token);
          setState("reward_failed");
        }
      }, READY_TIMEOUT_MS);

      void loadGpt().then(() => {
        if (tokenRef.current !== token) return; // superseded/cancelled
        const gt = window.googletag!;
        gt.cmd.push(() => {
          if (tokenRef.current !== token) return;
          const slot = gt.defineOutOfPageSlot(adUnitPath, gt.enums.OutOfPageFormat.REWARDED);
          if (!slot) {
            clearTimeout(timeout);
            releaseToken(token);
            setState("reward_failed");
            return;
          }
          slotRef.current = slot;
          slot.addService(gt.pubads());
          const pubads = gt.pubads();

          const onReady = (event: GptSlotReadyEvent) => {
            if (tokenRef.current !== token) return;
            clearTimeout(timeout);
            makeVisibleRef.current = () => event.makeRewardedVisible();
            setState("reward_ready");
          };
          const onGranted = (event: GptSlotGrantedEvent) => {
            if (tokenRef.current !== token || grantedRef.current) return; // idempotent
            grantedRef.current = true;
            void event.payload;
            setState("reward_granted");
          };
          const onClosed = () => {
            if (tokenRef.current !== token) return;
            // A grant that arrived before close is handled already — closing
            // afterward must never downgrade it back to "not granted". Either
            // way the slot is done with, so the lock releases regardless.
            releaseToken(token);
            setState((s) => (grantedRef.current ? s : "reward_closed"));
          };
          const onRenderEnded = (event: GptSlotRenderEndedEvent) => {
            if (tokenRef.current !== token) return;
            if (event.slot === slot && event.isEmpty) {
              clearTimeout(timeout);
              releaseToken(token);
              setState("reward_failed");
            }
          };

          pubads.addEventListener("rewardedSlotReady", onReady as (e: never) => void);
          pubads.addEventListener("rewardedSlotGranted", onGranted as (e: never) => void);
          pubads.addEventListener("rewardedSlotClosed", onClosed as (e: never) => void);
          pubads.addEventListener("slotRenderEnded", onRenderEnded as (e: never) => void);
          listenersRef.current = [
            { type: "rewardedSlotReady", fn: onReady as (e: never) => void },
            { type: "rewardedSlotGranted", fn: onGranted as (e: never) => void },
            { type: "rewardedSlotClosed", fn: onClosed as (e: never) => void },
            { type: "slotRenderEnded", fn: onRenderEnded as (e: never) => void },
          ];

          gt.enableServices();
          gt.display(slot);
        });
      });
    },
    [destroy, setState, releaseToken],
  );

  /** The ONLY function allowed to call `makeRewardedVisible()` — and only
   *  once the slot has genuinely reported ready. */
  const show = useCallback(() => {
    if (state !== "reward_ready" || !makeVisibleRef.current) return;
    setState("reward_showing");
    makeVisibleRef.current();
  }, [state]);

  const reset = useCallback(() => {
    destroy();
    setState("idle");
  }, [destroy]);

  return { state, request, show, reset };
}
