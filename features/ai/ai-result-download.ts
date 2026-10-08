"use client";

import { startDownload } from "@/features/downloads/manager";
import { resultFileName, resultSuffixFor } from "@/lib/ai/media";
import type { AiJobView } from "@/lib/ai/jobs";
import type { DownloadRecord } from "@/types";
import { AI_VIDEO_SAVE_EVENT } from "@/lib/ads-platform/moment-events";
import { haptic } from "@/lib/motion/haptics";

/**
 * Saving a finished AI video — the ONE implementation.
 *
 * ── 🔴 WHY THIS IS NOT INLINE IN THE RESULT PANEL ANY MORE ──────────────────
 *
 * It was, and then history (2026-09-09) needed the same button on a second
 * screen. Two copies of this would be two copies of four separate decisions the
 * owner has already corrected once each — the same-origin route, the download
 * manager rather than an `<a>`, the `Frenz AI` platform label, and the file
 * name — and the copy on the newer screen would be the one that quietly drifts.
 *
 * ── The url is OURS, and it is stable ────────────────────────────────────────
 *
 * Not a Supabase signed url. `<a download>` is ignored cross-origin, so a raw
 * storage link navigates to Supabase's own preview page instead of saving
 * (owner, 2026-09-08, with a screenshot of exactly that). This route re-signs on
 * every request and 302s, which makes it both same-origin AND storable: a
 * history row written today still works for the three days the file is kept,
 * where a signed url would have died in minutes.
 *
 * ── The platform's download manager, not a link ─────────────────────────────
 *
 * `startDownload` is what carries the completion card, its sound and haptic, the
 * history row written when the file actually lands, double-tap protection and
 * serialised device-saves. `directUrl` tells the manager to fetch THIS url
 * rather than push it through the /api/download extractor, which knows nothing
 * about AI jobs. Wallpapers use the same field for the same reason.
 */
export function aiResultDownloadHref(jobId: string): string {
  return `/api/ai/jobs/${encodeURIComponent(jobId)}/result?download=1&redirect=1`;
}

/**
 * 2026-10-07 (owner: "make the ai history video preview use the same preview
 * with the download history viewer"): an AI result as a record the downloads
 * viewer can open. It streams our same-origin result route (`directUrl`) —
 * never the link extractor — and carries the job id so the viewer offers
 * "Share to AI Reels" rather than a plain publish.
 */
export function aiJobRecord(job: AiJobView): DownloadRecord {
  // 🔴 2026-10-07 (owner: "AI video in AI history does not play, it shows white"): `redirect=1` alone is NOT a redirect —
  // the route answers JSON `{url}` unless `download=1` is set too, and the viewer played that JSON as a video.
  // The same address the working download uses.
  const href = aiResultDownloadHref(job.id);
  return {
    id: `ai-${job.id}`,
    url: href,
    directUrl: href,
    aiJobId: job.id,
    platform: "generic",
    platformName: "Frenz AI",
    title: resultFileName(job.source.name, resultSuffixFor(job.feature)),
    thumbnail: job.result?.hasPoster ? `/api/ai/jobs/${encodeURIComponent(job.id)}/poster` : null,
    formatId: "frenz-ai",
    kind: "video",
    qualityLabel: "Frenz AI",
    durationSeconds: job.result?.durationSeconds ?? job.source.durationSeconds ?? null,
    createdAt: Date.now(),
    favorite: false,
  };
}

/** Starts the download through the platform's one manager; answers the task id (null = refused by the storage ceiling). */
export function startAiResultDownload(job: AiJobView): string | null {
  haptic("light");
  return startAiResultDownloadById({ id: job.id, feature: job.feature, name: job.source.name, durationSeconds: job.source.durationSeconds ?? null });
}

/**
 * The same save from a screen that only has the id (the result card under a
 * finished generation). 🔴 2026-10-07: that card used `<a href={signedUrl}
 * download>` — `download` is ignored cross-origin, so on iPhone it opened the
 * file in the browser instead of saving it. It now goes through the
 * downloader's own manager like every other save.
 */
export function startAiResultDownloadById(job: { id: string; feature: string; name?: string | null; durationSeconds?: number | null }): string | null {
  haptic("light");
  const href = aiResultDownloadHref(job.id);
  const taskId = startDownload({
    url: href,
    directUrl: href,
    platform: "generic",
    platformName: "Frenz AI",
    title: resultFileName(job.name ?? null, resultSuffixFor(job.feature)),
    thumbnail: null,
    formatId: "frenz-ai",
    kind: "video",
    qualityLabel: job.feature === "ai_character_replace" ? "Character Replace" : "Frenz AI",
    durationSeconds: job.durationSeconds ?? null,
  });
  /*
    Ad Platform Part 5: a paid sponsor video MAY play beside this save
    (placement ai_video_save_reward, admin-controlled). Fired AFTER the save
    has started and never awaited — the standing rule is no reward ads for AI
    access, so nothing about the save waits on, or depends on, an ad.
  */
  if (taskId) {
    try {
      window.dispatchEvent(new Event(AI_VIDEO_SAVE_EVENT));
    } catch {
      /* a listener's failure is never the save's */
    }
  }
  return taskId;
}
