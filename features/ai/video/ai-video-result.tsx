"use client";

import { Download, RotateCcw } from "lucide-react";
import Link from "next/link";

import { AiResultShare } from "@/features/ai/video/ai-result-share";
import type { FinishedJob } from "@/features/ai/video/use-video-generation";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RESULT — a finished thing, not a status row (Part 6 §23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "When generation completes, the result should feel like a finished product.
 * Show: large media preview, download, save, share where supported, regenerate
 * where appropriate… Avoid cluttering the result with every technical detail."
 *
 * So: the video, large, and three actions. No model name, no task id, no
 * duration in milliseconds — none of which the member asked for. The
 * technical record lives on the job row for the admin.
 *
 * ── 🔴 THE URL IS ALWAYS OURS ─────────────────────────────────────────────
 *
 * `resultUrl` is a short-lived signed link minted by `/api/ai/jobs/[id]/result`
 * after an ownership check — never the provider's CDN URL. That is the existing
 * contract and this component does not change it; it just renders what it is
 * given and shows nothing at all if the link has not arrived yet.
 */
export function AiVideoResult({
  job,
  historyHref,
  onAgain,
  className,
}: {
  job: FinishedJob;
  historyHref: string;
  onAgain?: () => void;
  className?: string;
}) {
  const src = job.resultUrl;
  return (
    <section className={cn("overflow-hidden rounded-[1.75rem] bg-white/80 ring-1 ring-inset ring-white/70 shadow-[0_18px_50px_-28px_rgba(76,58,160,0.45)]", className)} aria-label="Your video">
      <div className="relative aspect-video w-full bg-slate-900/[0.04]">
        {src ? (
          /*
            `preload="metadata"` and a poster: the first frame and the duration
            arrive without pulling the whole file, which matters on a phone and
            is what §36 means by not loading every tool's media up front.
          */
          <video
            src={src}
            poster={job.posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="ai-materialize h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-[13px] text-muted-foreground">Preparing your video…</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3.5 sm:p-4">
        {src ? (
          <a
            href={src}
            download
            className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-foreground px-4 text-[13.5px] font-semibold text-background transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </a>
        ) : null}
        {onAgain ? (
          <button
            type="button"
            onClick={onAgain}
            className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-white px-4 text-[13.5px] font-semibold ring-1 ring-inset ring-black/[0.08] transition hover:bg-white/90 active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Make another
          </button>
        ) : null}
        <Link
          href={historyHref}
          className="ml-auto inline-flex min-h-[2.75rem] items-center rounded-full px-3 text-[13px] font-semibold text-violet-700 transition hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          All your videos
        </Link>
      </div>
      {/* 2026-10-07 (owner brief §5–§6): the reward it earned and "Share to AI Reels" — the server's answer, once */}
      {src ? <AiResultShare jobId={job.id} /> : null}
    </section>
  );
}
