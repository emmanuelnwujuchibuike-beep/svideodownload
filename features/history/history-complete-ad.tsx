"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { onDownloadCompleted } from "@/features/downloads/manager";

/*
  Split, because it renders nothing until a transfer completes — most visits to
  /history never start one, and they should not pay for this chunk.
*/
const DownloadCompleteAd = dynamic(
  () => import("@/features/monetization/download-complete-ad").then((m) => m.DownloadCompleteAd),
  { ssr: false },
);

/**
 * The after-download ad, for downloads started from /history.
 *
 * Owner, 2026-08-24: "all Downloads must trigger the Download complete ad,
 * that can be used in Adsense too."
 *
 * /downloads and the landing page already get this through
 * `download-box.tsx`; /history renders neither, so a retry started here was the
 * one download in the app that finished with no completion ad. This is the
 * missing mount, and nothing more — the ad itself, its zone and its AdSense
 * support are all unchanged.
 *
 * It listens to the MANAGER's completion event rather than to the retry button,
 * deliberately: that is the only honest signal that bytes actually landed. A
 * button press is a request, not a finished download, and an ad shown for a
 * transfer that then failed is both a wasted impression and a lie.
 */
export function HistoryCompleteAd() {
  const [open, setOpen] = useState(false);
  useEffect(() => onDownloadCompleted(() => setOpen(true)), []);
  return <DownloadCompleteAd open={open} onClose={() => setOpen(false)} />;
}
