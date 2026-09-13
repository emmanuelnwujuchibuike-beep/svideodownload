"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { useUploadAheadProgress } from "./upload-ahead";

/**
 * The thin line along the bottom of a media preview that says a video is
 * already on its way up — and, when it is up, says so with a check.
 *
 * Owner, 2026-09-13: "posting a video takes too long." The upload now begins
 * when the file is picked (upload-ahead.ts); this is how the member SEES it,
 * so the wait is spent while they type a caption, not after they tap Share.
 *
 * Nothing when there is no job (a photo, or a failed head start — that one
 * uploads at publish time and the publish button reports it). Absolutely
 * positioned inside a `relative overflow-hidden` preview; the caller owns
 * that container.
 */
export function UploadAheadStrip({ itemId, className }: { itemId: string | null | undefined; className?: string }) {
  const job = useUploadAheadProgress(itemId);
  if (!job || job.status === "failed") return null;
  const pct = Math.round(job.progress * 100);
  const done = job.status === "done";
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 bottom-0", className)} aria-live="polite">
      <div className="flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-5 text-[11px] font-semibold text-white">
        <span className="flex items-center gap-1.5">
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : null}
          {done ? "Uploaded" : `Uploading ${pct}%`}
        </span>
      </div>
      <div className="h-[3px] w-full bg-white/20">
        <div
          className={cn("h-full transition-[width] duration-300", done ? "bg-emerald-400" : "bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500")}
          style={{ width: `${done ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}
