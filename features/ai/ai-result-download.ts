"use client";

import { startDownload } from "@/features/downloads/manager";
import { cleanedFileName } from "@/lib/ai/clean-media";
import type { AiJobView } from "@/lib/ai/jobs";
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

export function startAiResultDownload(job: AiJobView): void {
  haptic("light");
  const href = aiResultDownloadHref(job.id);
  startDownload({
    url: href,
    directUrl: href,
    platform: "generic",
    platformName: "Frenz AI",
    title: cleanedFileName(job.source.name),
    thumbnail: null,
    formatId: "ai-clean",
    kind: "video",
    qualityLabel: "AI Clean",
    durationSeconds: job.source.durationSeconds ?? null,
  });
}
