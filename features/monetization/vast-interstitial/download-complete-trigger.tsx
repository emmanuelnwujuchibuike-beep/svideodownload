"use client";

import { useEffect } from "react";

import { DOWNLOAD_COMPLETED_EVENT } from "@/lib/downloads/completion-event";

/**
 * The skippable video ad that plays once a download has actually FINISHED.
 *
 * Owner, 2026-08-30: "download completed in the landing pages and download,
 * history and all pages should trigger a 5 to 15 sec skipable video ad."
 *
 * ── Why a completion event and not a call site ────────────────────────────────
 *
 * A download can be started from the downloader, the history tiles, the media
 * gallery, a wallpaper, a public post page and the multi-link batch panel. Six
 * call sites, each of which would have to remember to fire this — and the
 * seventh, added later, would not. Every one of those paths funnels through the
 * download manager's completion path, which dispatches
 * `DOWNLOAD_COMPLETED_EVENT`, so arming this once covers all of them and cannot
 * drift.
 *
 * ── It costs a cold page load nothing ─────────────────────────────────────────
 *
 * Mounted from `DeferredShell` (the ROOT layout — the "all pages" half of the
 * ask), so what it imports matters more than what it does. It imports one
 * string. The manager is NOT imported here: see
 * `lib/downloads/completion-event.ts` for why that distinction is the whole
 * reason the event exists. The config fetch, the VAST request and the player
 * all stay behind a dynamic `import()`, so nothing about the ad is parsed until
 * a download has genuinely completed.
 *
 * ── A batch finishes N times and must show ONE ad ─────────────────────────────
 *
 * The event fires once PER FILE, so a twelve-photo TikTok slideshow fires twelve
 * times within a few seconds. Two existing guards handle that and neither is
 * re-implemented here: `requestVastInterstitial` refuses while one is already in
 * flight (`phase !== "idle"` → "busy"), and the cooldown refuses for
 * `cooldownMs` afterwards. The batch's own completion ad
 * (`batchCompleteSeconds`) is a separate, longer-standing placement, untouched.
 */
export function VastDownloadCompleteTrigger() {
  /*
    Warm the modules and the config while the browser is idle, so a completed
    download pays for the VAST request and the media file and nothing else. See
    `warmVastInterstitial`.

    `requestIdleCallback` where it exists, a late timeout where it does not —
    this must never compete with the page load it is mounted into, and Safari
    still has no idle callback.
  */
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void import("./request")
        .then((m) => m.warmVastInterstitial())
        .catch(() => {
          /* The on-demand path still works — this is only a head start. */
        });
    };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    const id = ric ? ric(warm, { timeout: 4000 }) : window.setTimeout(warm, 2500);
    return () => {
      cancelled = true;
      if (!ric) window.clearTimeout(id as number);
    };
  }, []);

  useEffect(() => {
    const onCompleted = () => {
      void import("./request")
        .then((m) => m.requestVastInterstitial("download-complete"))
        .catch(() => {
          /*
            An ad that cannot load its own module is not the visitor's problem —
            and this fires AFTER the file is saved, so there is nothing left for
            a failure here to break.
          */
        });
    };
    window.addEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
    return () => window.removeEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);
  }, []);

  return null;
}
