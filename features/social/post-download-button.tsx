"use client";

import { Download } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { detectPlatform } from "@/lib/platforms";
import type { MediaKind } from "@/types";

const FloatingDownloadProgress = dynamic(
  () => import("@/features/downloads/floating-progress").then((m) => m.FloatingDownloadProgress),
  { ssr: false },
);

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
  const [progressReady, setProgressReady] = useState(false);

  const onClick = () => {
    setProgressReady(true);
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
        className="group relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 text-sm font-bold text-white shadow-lg shadow-violet-600/30 ring-1 ring-inset ring-white/15 transition-all duration-200 hover:-translate-y-px hover:shadow-xl hover:shadow-violet-600/40 active:translate-y-0 active:scale-[0.98]"
      >
        {/* Luxury sheen that sweeps across on hover */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />
        <Download className="relative h-[18px] w-[18px]" strokeWidth={2.5} />
        <span className="relative">Download</span>
      </button>
      {/* Progress card for public pages outside the app shell (singleton). */}
      {progressReady ? <FloatingDownloadProgress /> : null}
    </>
  );
}
