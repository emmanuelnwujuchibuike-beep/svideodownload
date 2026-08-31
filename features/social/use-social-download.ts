"use client";

import { useCallback, useRef, useState } from "react";

import { savePostMedia } from "@/lib/media/download-post";
import { toast } from "@/features/ui/toast";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOWNLOADING A POST — on the page it is on, from OUR storage
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-31: "Downloading multi post in feed just dispears and show in
 * the Download page Successful but when I try to review it shows blank ... it
 * should download through it social Download route like Twitter not going
 * through the link download route in the landing page ... it should download
 * directly on same page ... and it should show clear and high quality ...
 * should save in same page like Twitter and save to device."
 *
 * ── What was actually happening ──────────────────────────────────────────────
 *
 * `PostDownloadButton` called `startDownload()` — the LANDING PAGE's link
 * pipeline. That path exists to re-extract a video from a THIRD-PARTY source
 * URL with yt-dlp, which is the right thing for a pasted TikTok link and the
 * wrong thing for a post whose media we are already hosting:
 *
 *  • it queued into the downloader's manager, so the item "disappeared" from
 *    the feed and reappeared on /downloads — the owner's "just dispears";
 *  • it re-extracted from `sourceUrl`, which for a Frenz-native upload is not a
 *    downloadable source at all, so the queue reported Successful over a file
 *    with nothing in it — the owner's "shows blank";
 *  • and it only ever knew about ONE url, so an album lost every item but the
 *    cover (fixed server-side too — see the download route).
 *
 * ── What it does now ─────────────────────────────────────────────────────────
 *
 * The same two steps Twitter's save does, and nothing else:
 *
 *  1. POST the post's own download route. That is the SOCIAL route: it checks
 *     visibility, spends the free daily allowance, bumps the counter, and
 *     answers with every file the post is made of.
 *  2. Hand each file to `saveMediaToDevice`, which fetches the ORIGINAL stored
 *     object through our own origin and gives it to the OS — the share sheet on
 *     iOS (the only path to the Photos library) or a blob download elsewhere.
 *
 * No queue, no navigation, no re-extraction, no landing-page pipeline. The
 * bytes saved are the bytes we stored, so "clear and high quality" is not a
 * setting — it is the absence of a re-encode.
 *
 * ── Honest reporting ─────────────────────────────────────────────────────────
 *
 * `saveMediaToDevice` distinguishes saved / shared / cancelled / failed, and so
 * does this: a dismissed iOS share sheet is the person saying no, and telling
 * them "Saved" is how a download bug goes unreported for a month. An album
 * reports how many of its items actually landed.
 */

export type SocialDownloadState = "idle" | "working" | "done" | "error";

/**
 * React state around `savePostMedia` — the SAME core the feed calls through
 * `downloadPost`. Deliberately not a second implementation: the feed and the
 * post page drifting apart on how a save works is how one of them ends up
 * queueing images as videos again.
 */
export function useSocialDownload() {
  const [state, setState] = useState<SocialDownloadState>("idle");
  /** Which item of an album is in flight, for a "2 of 5" label. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Guards a double-tap from spending two of the five free daily downloads. */
  const busy = useRef(false);

  const download = useCallback(async (postId: string) => {
    if (busy.current) return;
    busy.current = true;
    setState("working");
    setProgress(null);

    const result = await savePostMedia(postId, (done, total) => setProgress({ done, total }));
    busy.current = false;

    if (result.error) {
      setState("error");
      toast(result.error, "error", { duration: result.error.includes("Pro") ? 6000 : 4000 });
      return;
    }
    if (result.saved === 0) {
      // Cancelled is the person saying no — not an error to shout about.
      setState("idle");
      if (result.cancelled === 0) toast("Couldn’t save that.", "error");
      return;
    }
    setState("done");
    toast(
      result.total > 1
        ? `Saved ${result.saved} of ${result.total} to your device`
        : "Saved to your device",
      "success",
    );
  }, []);

  return { download, state, progress };
}
