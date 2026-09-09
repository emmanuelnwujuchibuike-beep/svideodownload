"use client";

import dynamic from "next/dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DOWNLOAD CARD, ON THE PUBLIC AI ROUTES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "frenz ai downloads complete pop up doesnt show on the ai
 * pages, it shows when i go back to the landing or download page, it shouldnt
 * be like that."
 *
 * Exactly right, and the reason is that `FloatingDownloadProgress` has never
 * been global. It is mounted by the surfaces that historically started
 * downloads:
 *
 *   AppOverlays          the (app) and /u layouts
 *   Downloader           the landing and the platform pages
 *   DownloadBox          the download hub
 *   WallpaperExplore     /wallpapers
 *
 * AI Clean routes its result through `startDownload` like everything else, so
 * the download really did run — but on `/ai/clean` nothing was mounted to draw
 * the card. It then appeared on the next page that happened to mount one, which
 * is the "it shows when i go back" the owner saw: not a delayed card, a card
 * rendered by a different page about a task that finished minutes ago.
 *
 * ── 🔴 WHY ONLY THE MARKETING ROUTE MOUNTS THIS ─────────────────────────────
 *
 * `/studio/ai/clean` is inside the (app) group, whose layout already renders
 * `AppOverlays` unconditionally. Putting this in the shared `AICleanWorkspace`
 * would give that route TWO instances, and the component has no singleton
 * guard — two mounts is two cards, two sounds and two haptics.
 *
 * So the mount lives on the PAGE that is missing one, not in the component both
 * pages share. One line, in the one place where it is true.
 *
 * `ssr: false` and code-split, exactly as every other mount of it is: the chunk
 * is only fetched in a browser, and `/ai/clean` is already `force-dynamic`, so
 * nothing here touches the static marketing budget.
 */
const FloatingDownloadProgress = dynamic(
  () => import("@/features/downloads/floating-progress").then((m) => m.FloatingDownloadProgress),
  { ssr: false },
);

export function AIDownloadOverlay() {
  return <FloatingDownloadProgress />;
}
