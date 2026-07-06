"use client";

import { Download } from "lucide-react";

import { FloatingDownloadProgress } from "@/features/downloads/floating-progress";
import { startDownload } from "@/features/downloads/manager";
import { detectPlatform } from "@/lib/platforms";
import type { MediaKind } from "@/types";

/**
 * Public-page download: re-extracts from the original source on demand via the
 * existing /api/download pipeline (no file is hosted by us) — streamed in the
 * background with the floating progress card (never a raw-file navigation) —
 * then beacons a download event so the counter + trending reflect it.
 */
export function PostDownloadButton({
  postId,
  sourceUrl,
  mediaKind,
  title,
}: {
  postId: string;
  sourceUrl: string;
  mediaKind: MediaKind;
  title: string;
}) {
  const onClick = () => {
    const platform = detectPlatform(sourceUrl);
    startDownload({
      url: sourceUrl,
      formatId: "best",
      kind: mediaKind,
      title,
      thumbnail: null,
      platform: platform.id,
      platformName: platform.name,
      qualityLabel: mediaKind === "audio" ? "Audio" : mediaKind === "image" ? "Image" : "Video",
    });
    // Count it (best-effort, non-blocking).
    navigator.sendBeacon?.(
      `/api/posts/${postId}/event`,
      new Blob([JSON.stringify({ type: "download" })], { type: "application/json" }),
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-95 active:scale-[0.99]"
      >
        <Download className="h-4 w-4" /> Download
      </button>
      {/* Progress card for public pages outside the app shell (singleton). */}
      <FloatingDownloadProgress />
    </>
  );
}
