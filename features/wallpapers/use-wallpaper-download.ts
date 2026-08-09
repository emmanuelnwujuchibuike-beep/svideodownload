"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { resolutionBadge, type Wallpaper } from "@/lib/wallpapers";
import { WALLPAPER_REWARD_SECONDS } from "@/lib/wallpapers-limits";

export interface WallpaperAllowance {
  /** 0 = uncapped (Pro / Business). */
  limit: number;
  used: number;
  /** null when uncapped. */
  remaining: number | null;
  needsAd: boolean;
  adSeconds: number;
}

/**
 * One place that knows how to download a wallpaper — the allowance, the ad, the
 * transfer and the notifications.
 *
 * Shared by the grid, the reels viewer and the download page's section, because
 * all three have a download button and all three must obey the same rule. The
 * previous arrangement had the interstitial logic in one hook and the transfer
 * in three separate call sites, which is how the two surfaces ended up firing
 * ads on different schedules.
 *
 * ── The order of events (owner, 2026-08-09) ───────────────────────────────────
 * "Download button should download the wallpaper immediately and notify,
 * download started, and also notify download finished in the respective page the
 * user is on" — alongside "all the download buttons show a 30-second reward ad
 * when a free user clicks it".
 *
 * Those pull in opposite directions if the ad BLOCKS the transfer, so it
 * doesn't: the file starts the instant the button is tapped and the ad plays
 * over the top while the bytes arrive. Nobody watches a countdown and then waits
 * again for a download to begin, and the ad still gets its full 30 seconds of
 * attention. The "finished" notification is the floating progress card, which
 * every wallpaper surface now mounts — so it appears on whichever page the
 * download was started from.
 *
 * ── Why the client checks a limit the server enforces ─────────────────────────
 * The gate is in `/api/wallpaper?dl=1` and that is the one that counts. This
 * check exists so someone at their limit is told BEFORE they sit through an ad
 * for a download that was never going to happen — a refusal after the ad is the
 * version of this that feels like a con.
 */
export function useWallpaperDownload() {
  const [allowance, setAllowance] = useState<WallpaperAllowance | null>(null);
  const [adOpen, setAdOpen] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  // The allowance is read once per mount and adjusted locally after that, so a
  // grid of forty wallpapers costs one request rather than one per tap.
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    let alive = true;
    void fetch("/api/wallpapers/allowance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WallpaperAllowance | null) => {
        if (alive && d) setAllowance(d);
      })
      .catch(() => {
        /* unreachable — the server gate still applies, so this only costs the
           "N left today" label, never correctness */
      });
    return () => {
      alive = false;
    };
  }, []);

  const download = useCallback(
    (wallpaper: Wallpaper) => {
      const capped = allowance && allowance.limit > 0;
      if (capped && (allowance?.remaining ?? 1) <= 0) {
        haptic("medium");
        setLimitHit(true);
        return;
      }

      haptic("selection");
      playSound("tap");

      /*
        The download's identity, minted here rather than taken from the task,
        because it has to be IN the URL and the task id only exists after the
        transfer has been queued. It is what lets an automatic retry ride on the
        allowance unit the first attempt already spent — without it one flaky
        transfer would cost a free member a fifth of their day.
      */
      const downloadId = crypto.randomUUID();
      const sep = wallpaper.downloadUrl.includes("?") ? "&" : "?";
      const url = `${wallpaper.downloadUrl}${sep}t=${downloadId}`;

      startDownload({
        url,
        formatId: "wallpaper",
        kind: "image",
        title: `${wallpaper.name} wallpaper`,
        thumbnail: wallpaper.thumbUrl,
        platform: "generic",
        platformName: "Wallpaper",
        qualityLabel: resolutionBadge(wallpaper.width, wallpaper.height)?.long ?? "Full resolution",
        directUrl: url,
      });

      // "Started" is said out loud; "finished" is the floating progress card,
      // which is mounted on every wallpaper surface.
      toast(`Downloading ${wallpaper.name}…`, "success");

      if (capped) {
        setAllowance((a) => (a ? { ...a, used: a.used + 1, remaining: Math.max(0, (a.remaining ?? 1) - 1) } : a));
        if (allowance?.needsAd) setAdOpen(true);
      }
    },
    [allowance],
  );

  return {
    allowance,
    download,
    adOpen,
    closeAd: useCallback(() => setAdOpen(false), []),
    limitHit,
    closeLimit: useCallback(() => setLimitHit(false), []),
    adSeconds: allowance?.adSeconds ?? WALLPAPER_REWARD_SECONDS,
  };
}
