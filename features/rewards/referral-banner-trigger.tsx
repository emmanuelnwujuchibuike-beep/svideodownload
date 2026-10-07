"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { DOWNLOAD_COMPLETED_EVENT } from "@/lib/downloads/completion-event";

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
    const adOpen = () => !!document.querySelector('[role="dialog"][aria-label="Advertisement"]');
    const onCompleted = () => {
      let count = 0;
      try {
        count = (Number(localStorage.getItem(COUNT_KEY)) || 0) + 1;
        localStorage.setItem(COUNT_KEY, String(count));
      } catch {
        return; // no storage (private mode, sandboxed embed) — no counting, no banner
      }
      if (count < AFTER || Date.now() - lastShown < BURST_MS) return;
      lastShown = Date.now();
      const started = Date.now();
      // give the ad a moment to open first, then wait for it to close
      const tryShow = () => {
        if (adOpen() && Date.now() - started < 60_000) {
          waitTimer = window.setTimeout(tryShow, 1000);
          return;
        }
        setShow(true);
      };
      waitTimer = window.setTimeout(tryShow, 1500);
    };
    window.addEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
    return () => {
      window.removeEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
      if (waitTimer !== null) window.clearTimeout(waitTimer);
    };
  }, []);
  return show ? <ReferralBanner onClose={close} /> : null;
}
