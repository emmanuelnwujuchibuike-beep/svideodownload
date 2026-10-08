"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { isPlayerOpen, onPlayerChange, SAVED_TO_DEVICE_EVENT } from "@/features/downloads/player-store";
import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { AI_VIDEO_SAVE_EVENT } from "@/lib/ads-platform/moment-events";
import { claimMoment, mayShowAgain, nextFromPool, pageForPath, poolFor, recordShown } from "@/lib/ads-platform/serving-state";
import { AD_SLOTS, providerOrder, resolveSlotProvider } from "@/lib/ads-platform/slot-registry";
import { DOWNLOAD_COMPLETED_EVENT } from "@/lib/downloads/completion-event";
import { mayServeSlot } from "@/lib/monetization/ad-inventory-shape";
import { peekAdInventory } from "@/features/monetization/ad-inventory-client";

import { peekSelfAds } from "../serving-client";
import { SelfInterstitial } from "./self-interstitial";

/**
 * The paid full-screen MOMENTS — one listener set for the whole site.
 *
 *   download-complete  DOWNLOAD_COMPLETED_INTERSTITIAL, only after the manager
 *                      says a file really landed. While the media viewer is
 *                      open (the file still waiting on "Save to device") it
 *                      waits for the save or the close — never over the save.
 *   AI video save      REWARD_VIDEO beside the save that has ALREADY started.
 *                      Never a gate (standing rule: no reward ads for AI
 *                      access) — Continue and close work from the first frame.
 *   return             INTERSTITIAL when someone comes back after ≥5 s away,
 *                      at most once per the format's admin gap (120 s seeded).
 *
 * Each moment reads the payload already in memory (no request at the moment),
 * picks the next ad that is NOT the one shown last, and claims the moment so
 * the network unit for the same moment stands down — one ad per moment.
 * A batch of twelve files is ONE moment.
 */
const AWAY_MS = 5_000;
/** a batch's completions arrive within seconds of each other */
const SAME_MOMENT_MS = 15_000;

interface Showing {
  ad: EligibleAd;
  placement: string;
  page: string;
  reward: boolean;
  slot: string | undefined;
}

function noSelfMoment(pathname: string): boolean {
  return pathname.startsWith("/advertise/create") || pathname.startsWith("/advertise/payment") || pathname.startsWith("/studio/ai/character-replace") || pathname.startsWith("/ai/character-replace/create");
}

export function SelfMoments() {
  const pathname = usePathname() ?? "/";
  const tab = useSearchParams()?.get("tab") ?? null;
  const [showing, setShowing] = useState<Showing | null>(null);
  const where = useRef({ pathname, tab });
  where.current = { pathname, tab };
  const busy = useRef(false);
  const lastMomentAt = useRef(0);
  const aiSaveAt = useRef(0);

  /** Pick and claim. Returns what to show, or null — all synchronous. */
  const pick = useCallback((placement: string, moment: "download-complete" | "return" | null): Showing | null => {
    const { pathname: p, tab: t } = where.current;
    if (busy.current || noSelfMoment(p)) return null;
    const page = pageForPath(p, t);
    const payload = peekSelfAds();
    const pool = poolFor(payload, placement, page);
    if (!pool.ads.length || !mayShowAgain(placement, pool.rules)) return null;
    /*
      The moment is a canonical slot too (lib/ads-platform/slot-registry.ts):
      the paid campaign takes it only when it leads the admin's order among the
      providers that can serve. When the network leads, the network's own
      trigger keeps the moment and this stays out of the way.
    */
    const slot = AD_SLOTS.find((x) => x.kind === "moment" && x.paidPlacement === placement);
    if (slot) {
      const inv = peekAdInventory();
      const network = slot.networkZone ? inv === null || mayServeSlot(inv, slot.networkZone) || inv.vast.length > 0 : false;
      if (resolveSlotProvider(providerOrder(slot, payload?.order), { frenzsave: true, network }) !== "frenzsave") return null;
    }
    const ad = nextFromPool(placement, pool.ads);
    if (!ad) return null;
    if (moment) claimMoment(moment);
    return { ad, placement, page: page ?? "all_pages", reward: placement === "ai_video_save_reward", slot: slot?.id };
  }, []);

  const open = useCallback((s: Showing) => {
    busy.current = true;
    recordShown(s.placement, s.ad.cr);
    setShowing(s);
  }, []);

  // AI video save → the sponsor video, beside the save
  useEffect(() => {
    const onSave = () => {
      const s = pick("ai_video_save_reward", "download-complete");
      if (!s) return;
      aiSaveAt.current = Date.now();
      open(s);
    };
    window.addEventListener(AI_VIDEO_SAVE_EVENT, onSave);
    return () => window.removeEventListener(AI_VIDEO_SAVE_EVENT, onSave);
  }, [pick, open]);

  // A finished download → the completed interstitial, after delivery
  useEffect(() => {
    let cancelWait: (() => void) | null = null;
    const onCompleted = () => {
      const now = Date.now();
      // the AI save already had its moment, and a batch is one moment
      if (now - aiSaveAt.current < 60_000 || now - lastMomentAt.current < SAME_MOMENT_MS) return;
      const s = pick("download_completed_interstitial", "download-complete");
      if (!s) return;
      lastMomentAt.current = now;
      if (!isPlayerOpen()) {
        open(s);
        return;
      }
      // the file is still waiting in the viewer — never cover "Save to device"
      busy.current = true;
      const done = () => {
        cancelWait?.();
        cancelWait = null;
        busy.current = false;
        open(s);
      };
      const offPlayer = onPlayerChange(() => {
        if (!isPlayerOpen()) done();
      });
      window.addEventListener(SAVED_TO_DEVICE_EVENT, done);
      cancelWait = () => {
        offPlayer();
        window.removeEventListener(SAVED_TO_DEVICE_EVENT, done);
      };
    };
    window.addEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
    return () => {
      window.removeEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
      cancelWait?.();
    };
  }, [pick, open]);

  // Back after ≥5 s away → the interstitial, within the admin's gap
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away < AWAY_MS || isPlayerOpen()) return;
      const s = pick("interstitial", "return");
      if (s) open(s);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pick, open]);

  const close = useCallback(() => {
    busy.current = false;
    setShowing(null);
  }, []);

  if (!showing) return null;
  return <SelfInterstitial key={showing.ad.cr} ad={showing.ad} placement={showing.placement} page={showing.page} reward={showing.reward} slot={showing.slot} onClose={close} />;
}
