"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { onDownloadCompleted } from "@/features/downloads/manager";
import { usePlayerQueue } from "@/features/downloads/player-store";

const DownloadPlayer = dynamic(
  () => import("@/features/downloads/download-player").then((m) => m.DownloadPlayer),
  { ssr: false },
);

/**
 * Mounts the in-browser review player only once something is queued to watch.
 *
 * Its own client module ON PURPOSE: the Downloader dynamic-imports THIS
 * (`ssr:false`), so `player-store` (and the player chunk) load after hydration
 * rather than on the landing page's first-load bundle, which the 2-second budget
 * cannot afford. The player itself is a second dynamic import, so its heavier
 * chunk only arrives when a visitor actually reviews a download.
 */
export function ReviewPlayerMount() {
  const queue = usePlayerQueue();

  // Warm the player chunk the moment a download finishes — the visitor is about
  // to see the completion card and is one tap from "Review video", so the import
  // should already be in flight. Combined with the in-memory media cache, the
  // first review then opens and plays with no visible load.
  useEffect(() => onDownloadCompleted(() => void import("@/features/downloads/download-player")), []);

  return queue ? <DownloadPlayer /> : null;
}
