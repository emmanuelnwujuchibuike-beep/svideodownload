"use client";

import { useCallback, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { rewardAdsFor, type RewardAd } from "@/lib/monetization/reward-policy";
import type { DownloadRecord } from "@/types";

/**
 * Retrying a failed/cancelled download, through the SAME reward-ad policy a
 * first attempt goes through.
 *
 * Owner, 2026-08-24: "every retry downloads should follow same ad system like
 * others, batch = reward ad, too 2 high quality videos = reward ad, and no
 * single image should show a reward ad, but all Downloads must trigger the
 * Download complete ad."
 *
 * ── Why this exists rather than calling startDownload directly ─────────────
 * Both retry controls (the list row and the grid tile) called `startDownload`
 * straight away, so a retry was a free download — the one path that skipped
 * monetisation entirely, on exactly the files most likely to be large. This
 * routes it back through `rewardAdsFor`, the same pure policy the preview card
 * uses, so the two can never drift into different rules.
 *
 * ── How the owner's three rules fall out of the existing policy ────────────
 * They already do, which is why this reuses it rather than writing new rules:
 *
 *   • "no single image should show a reward ad" — `rewardAdsFor` gates images
 *     and audio ONLY when the chosen option was top-tier. A retry carries no
 *     quality rank (history stores a label, not a rank), so `qualityRank` is
 *     null, `isTopTier` is false, and an image retry is never gated. ✔
 *   • "2 high quality videos = reward ad" — the video branch is driven by
 *     BYTE SIZE, and `DownloadRecord.size` is the exact recorded size of the
 *     original transfer. A large video earns one ad and a very large one earns
 *     two, identically to a first attempt. ✔
 *   • "batch = reward ad" — batch retries go through the existing batch gate
 *     (`batch_download_gate`), which is a separate surface from this hook.
 *
 * 🔴 An unknown size fails OPEN (no ad) — inherited from the policy
 * deliberately, and correct here too: a cancelled download often never
 * reported a size, and charging someone an ad because WE failed to record
 * something is the wrong side to err on.
 */
export function useGatedRetry(): {
  /** Ask to retry. Returns the ads that must be watched first (possibly none). */
  begin: (record: DownloadRecord) => void;
  /** The pending ad queue — feed it to `RewardedAdGate`. */
  ads: RewardAd[];
  /** Called when the current ad completes; advances or starts the download. */
  grantOne: () => void;
  /** Abandon the retry. */
  cancel: () => void;
  /** True while an ad is owed. */
  gated: boolean;
} {
  const { showAds } = useShowAds();
  const [ads, setAds] = useState<RewardAd[]>([]);
  const [pending, setPending] = useState<DownloadRecord | null>(null);

  const run = useCallback((record: DownloadRecord) => {
    startDownload({
      url: record.url,
      formatId: record.formatId,
      kind: record.kind,
      title: record.title,
      thumbnail: record.thumbnail,
      platform: record.platform,
      platformName: record.platformName,
      qualityLabel: record.qualityLabel,
      durationSeconds: record.durationSeconds ?? null,
      // Preserved so a wallpaper (relative /api/wallpaper URL) retries against
      // the same target instead of being rejected by /api/download.
      directUrl: record.directUrl ?? undefined,
    });
  }, []);

  const begin = useCallback(
    (record: DownloadRecord) => {
      const owed = rewardAdsFor({
        filesize: record.size ?? null,
        showAds,
        // A retry re-downloads the SAME media kind it originally was.
        kind: record.kind,
        // History stores a human quality LABEL ("1080p"), not the rank the
        // policy's tier rule needs, and inventing one would gate the wrong
        // files in both directions. Null means "not top tier", so the size
        // rule alone decides — which is the rule the owner described.
        qualityRank: null,
      });
      if (owed.length === 0) {
        run(record);
        return;
      }
      setPending(record);
      setAds(owed);
    },
    [run, showAds],
  );

  const grantOne = useCallback(() => {
    setAds((queue) => {
      const rest = queue.slice(1);
      if (rest.length === 0) {
        // Last ad watched — start the transfer. Deferred out of the state
        // updater so the download never begins during a React render pass.
        setPending((record) => {
          if (record) queueMicrotask(() => run(record));
          return null;
        });
      }
      return rest;
    });
  }, [run]);

  const cancel = useCallback(() => {
    setAds([]);
    setPending(null);
  }, []);

  return { begin, ads, grantOne, cancel, gated: ads.length > 0 };
}
