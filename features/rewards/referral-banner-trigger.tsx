"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { isPlayerOpen, onPlayerChange, SAVED_TO_DEVICE_EVENT } from "@/features/downloads/player-store";
import { DOWNLOAD_COMPLETED_EVENT } from "@/lib/downloads/completion-event";
import { sharedToday } from "@/features/rewards/referral-shared-today";
import { anotherModalOpen } from "@/lib/ui/modal-open";

const ReferralBanner = dynamic(() => import("@/features/rewards/referral-banner").then((m) => m.ReferralBanner), { ssr: false });

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "SHARE YOUR LINK, EARN CREDITS" — after a download, from the 3rd on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "it should show as a modal on download complete on every
 * download, including anonymous, it should show after 3 downloads and can be
 * skipped, but it must be a banner that they will need to read … all ai,
 * wallpapers, media, audio, video download".
 *
 * Every one of those saves goes through the ONE download manager, which fires
 * `DOWNLOAD_COMPLETED_EVENT` — so one listener here covers them all, and this
 * file imports one string (the same weight rule as the download-complete ad,
 * mounted beside it in DeferredShell). The banner itself is code-split and
 * fetched only when it is about to show.
 *
 *  · counted per browser (localStorage) — guests included;
 *  · shown on the 3rd completed download and every one after;
 *  · a batch fires once per file — one banner per burst (a 20 s window);
 *  · never on top of the download-complete video ad: it waits until the ad
 *    has closed (up to 60 s), then shows.
 *
 * 2026-10-08 (owner: "it should show after Download completes and not save to
 * device, and when a user have copy the link once it should not show again to
 * that device or user for that day"):
 *  · on iPhone the manager's "completed" is the FETCH — the file is not the
 *    member's until they tap Save to device in the viewer, which is exactly
 *    when this used to pop up over that button. While the viewer is open it now
 *    waits for the real delivery: Save to device succeeding, or the viewer
 *    closing. Event-driven — no timer runs while it waits;
 *  · once the link was shared or copied today, nothing shows until tomorrow
 *    (referral-shared-today.ts).
 */
const COUNT_KEY = "frenz:downloads-completed";
const AFTER = 3;
const BURST_MS = 20_000;

export function ReferralBannerTrigger() {
  const [show, setShow] = useState(false);
  const close = useCallback(() => setShow(false), []);
  useEffect(() => {
    let lastShown = 0;
    let waitTimer: number | null = null;
    // the network ad's dialog, or a paid campaign's (Ad Platform Part 5)
    // ANY full-screen dialog (an ad, a sheet) — never stack on it (lib/ui/modal-open.ts)
    const adOpen = () => anotherModalOpen();
    const onCompleted = () => {
      let count = 0;
      try {
        count = (Number(localStorage.getItem(COUNT_KEY)) || 0) + 1;
        localStorage.setItem(COUNT_KEY, String(count));
      } catch {
        return; // no storage (private mode, sandboxed embed) — no counting, no banner
      }
      if (count < AFTER || Date.now() - lastShown < BURST_MS || sharedToday()) return;
      lastShown = Date.now();
      const started = Date.now();
      // give the ad a moment to open first, then wait for it to close
      const tryShow = () => {
        if (adOpen()) {
          // still blocked after a minute: skip this time rather than open on top of it
          if (Date.now() - started < 60_000) waitTimer = window.setTimeout(tryShow, 1000);
          return;
        }
        if (isPlayerOpen()) {
          waitForDelivery();
          return;
        }
        setShow(true);
      };
      waitTimer = window.setTimeout(tryShow, 1500);
    };
    // the viewer is open: show once the file is really delivered (saved) or the viewer closes
    let stopWaiting: (() => void) | null = null;
    const waitForDelivery = () => {
      if (stopWaiting) return;
      const done = () => {
        stopWaiting?.();
        stopWaiting = null;
        if (!sharedToday() && !anotherModalOpen()) setShow(true);
      };
      const offPlayer = onPlayerChange(() => {
        if (!isPlayerOpen()) done();
      });
      window.addEventListener(SAVED_TO_DEVICE_EVENT, done);
      stopWaiting = () => {
        offPlayer();
        window.removeEventListener(SAVED_TO_DEVICE_EVENT, done);
      };
    };
    window.addEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
    return () => {
      window.removeEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
      if (waitTimer !== null) window.clearTimeout(waitTimer);
      stopWaiting?.();
    };
  }, []);
  return show ? <ReferralBanner onClose={close} /> : null;
}
