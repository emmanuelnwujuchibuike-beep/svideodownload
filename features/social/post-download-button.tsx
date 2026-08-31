"use client";

import { Check, Download, Loader2 } from "lucide-react";

import { useSocialDownload } from "@/features/social/use-social-download";

/**
 * Download a post — on the page it is on, straight to the device.
 *
 * ── 🔴 REWRITTEN 2026-08-31: it used the LANDING PAGE's pipeline ─────────────
 *
 * Owner: "it should download through it social Download route like Twitter not
 * going through the link download route in the landing page ... it should
 * download directly on same page ... and it should show clear and high quality".
 *
 * This component used to call `startDownload()` with the post's `sourceUrl`,
 * which queued into the downloader's manager and re-extracted the media from
 * the THIRD-PARTY source with yt-dlp. Three separate failures came out of that,
 * all of them reported at once:
 *
 *   • the item left the feed and turned up on /downloads ("just dispears");
 *   • a Frenz-native upload has no extractable third-party source, so the queue
 *     reported Successful over an empty file ("shows blank");
 *   • an album lost every item except the cover.
 *
 * It now goes through the post's own route and `saveMediaToDevice` — see
 * use-social-download.ts for the whole reasoning. `sourceUrl` is no longer a
 * prop because nothing here re-extracts anything any more; the bytes saved are
 * the bytes we stored, which is where the quality comes from.
 */
export function PostDownloadButton({
  postId,
  /**
   * Kept for the label only ("Save photo" reads wrong on a video). The MEDIA is
   * resolved server-side now, so this can never send the save down the wrong
   * path the way the old `mediaKind` + `sourceUrl` pair could.
   */
  mediaKind = "video",
  className = "",
}: {
  postId: string;
  mediaKind?: string;
  className?: string;
}) {
  const { download, state, progress } = useSocialDownload();

  const label =
    state === "working"
      ? progress && progress.total > 1
        ? `Saving ${progress.done + 1} of ${progress.total}`
        : "Saving…"
      : state === "done"
        ? "Saved"
        : mediaKind === "image"
          ? "Save photo"
          : "Download";

  return (
    <button
      type="button"
      onClick={() => void download(postId)}
      disabled={state === "working"}
      aria-live="polite"
      className={`group relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 text-sm font-bold text-white shadow-lg shadow-violet-600/30 ring-1 ring-inset ring-white/15 transition-all duration-200 hover:-translate-y-px hover:shadow-xl hover:shadow-violet-600/40 active:translate-y-0 active:scale-[0.98] disabled:opacity-80 ${className}`}
    >
      {/* Luxury sheen that sweeps across on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />
      {state === "working" ? (
        <Loader2 className="relative h-[18px] w-[18px] animate-spin" strokeWidth={2.5} />
      ) : state === "done" ? (
        <Check className="relative h-[18px] w-[18px]" strokeWidth={2.5} />
      ) : (
        <Download className="relative h-[18px] w-[18px]" strokeWidth={2.5} />
      )}
      <span className="relative">{label}</span>
    </button>
  );
}
