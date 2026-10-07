"use client";

import { Check, Clapperboard, Share2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { attributionLink, shareOrCopy } from "@/lib/referrals/share-client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AFTER THE VIDEO — the reward it earned, and "Share to AI Reels"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief 2026-10-07 §4–§6. Under a finished AI video:
 *   · a subtle "+N AI Credits" when the generation EARNED a reward — the
 *     number is the granted row's, read from /api/ai/jobs/[id]/rewards, never
 *     the rule's promise;
 *   · "Share to AI Reels" as the strong action, with "30s+ AI videos earn N
 *     credits…" ONLY when the server says this video qualifies (long enough,
 *     rule on, not yet rewarded) — a short video never sees a reward it can't get;
 *   · once published: "+N AI Credits" if the engine granted the share reward,
 *     a link to the reel, and Share — the member's attribution link, through the
 *     one share helper (native sheet, else copy).
 *
 * One read when the card appears, one write when the member publishes.
 */
interface RewardStatus {
  generation: { credits: number } | null;
  share: { credits: number } | null;
  postId: string | null;
  shareOffer: { credits: number; minSeconds: number } | null;
}

/** Kept per video for the session — a re-opened result paints its line at once; it changes only when the member publishes (written below). */
const statusCache = new Map<string, RewardStatus>();

export function AiResultShare({ jobId, reelsHref = "/reels" }: { jobId: string; reelsHref?: string }) {
  const [status, setStatusState] = useState<RewardStatus | null>(() => statusCache.get(jobId) ?? null);
  const setStatus = (next: RewardStatus | null | ((s: RewardStatus | null) => RewardStatus | null)) =>
    setStatusState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value) statusCache.set(jobId, value);
      return value;
    });
  const [composing, setComposing] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (statusCache.has(jobId)) return;
    let live = true;
    fetch(`/api/ai/jobs/${jobId}/rewards`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<RewardStatus>) : null))
      .then((s) => {
        if (live && s) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [jobId]);

  // a guest, or a read that failed: no reward line and no publishing — the video and its download stand alone
  if (!status) return null;

  async function publish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    haptic("selection");
    try {
      const res = await fetch(`/api/ai/jobs/${jobId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption: caption.trim() || null, visibility: "public" }),
      });
      const json = (await res.json().catch(() => ({}))) as { postId?: string; reward?: { credits: number } | null; error?: string };
      if (!res.ok || !json.postId) {
        setError(json.error ?? "Couldn't publish right now. Try again in a moment.");
        return;
      }
      haptic("medium");
      setComposing(false);
      setStatus((s) => (s ? { ...s, postId: json.postId!, share: json.reward ? { credits: json.reward.credits } : s.share, shareOffer: null } : s));
      toast(json.reward ? `Shared to AI Reels · +${json.reward.credits} AI Credits` : "Shared to AI Reels", "success");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function shareReel(postId: string) {
    haptic("selection");
    const url = (await attributionLink("ai_video", postId)) ?? `${window.location.origin}/p/${postId}`;
    const out = await shareOrCopy(url, "Made with Frenz AI");
    if (out === "copied") toast("Link copied.", "success");
    else if (out === "failed") toast("Couldn't share the link.", "error");
  }

  return (
    <div className="border-t border-black/[0.05] px-3.5 pb-3.5 pt-3 sm:px-4">
      {status.generation ? (
        <p className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />+{status.generation.credits} AI Credits
          <span className="font-normal text-emerald-700/80 dark:text-emerald-300/80">for this video</span>
        </p>
      ) : null}

      {status.postId ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-semibold">
            <Check className="h-4 w-4 text-emerald-600" aria-hidden />
            On AI Reels
            {status.share ? <span className="font-normal text-emerald-700 dark:text-emerald-300">· +{status.share.credits} AI Credits</span> : null}
          </p>
          <Link href={`${reelsHref}?start=${status.postId}`} prefetch={false} className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-violet-700 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
            <Clapperboard className="h-4 w-4" aria-hidden />
            View
          </Link>
          <button type="button" onClick={() => void shareReel(status.postId!)} className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full bg-white px-4 text-[13.5px] font-semibold ring-1 ring-inset ring-black/[0.08] transition hover:bg-white/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 motion-reduce:active:scale-100">
            <Share2 className="h-4 w-4" aria-hidden />
            Share
          </button>
        </div>
      ) : composing ? (
        <div>
          <label htmlFor={`reel-caption-${jobId}`} className="text-[12.5px] font-semibold">
            Caption <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={`reel-caption-${jobId}`}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Say something about it"
            className="mt-1.5 w-full resize-none rounded-xl bg-white px-3 py-2 text-[14px] ring-1 ring-inset ring-black/[0.08] focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          {error ? (
            <p role="alert" className="mt-1.5 text-[12.5px] font-semibold text-rose-600">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setComposing(false)} disabled={busy} className="inline-flex min-h-[2.75rem] items-center rounded-full px-4 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button type="button" onClick={() => void publish()} disabled={busy} className={cta}>
              {busy ? "Publishing…" : "Publish to AI Reels"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">Public on AI Reels. You can delete it any time from the reel.</p>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              setComposing(true);
            }}
            className={cn(cta, "w-full sm:w-auto")}
          >
            <Clapperboard className="h-4 w-4" aria-hidden />
            Share to AI Reels
          </button>
          {status.shareOffer ? (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {status.shareOffer.minSeconds}s+ AI videos can earn {status.shareOffer.credits} credits when shared to AI Reels.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

const cta =
  "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 px-5 text-[13.5px] font-semibold text-white shadow-[0_10px_24px_-14px_rgb(79_70_229/0.9)] transition active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 motion-reduce:active:scale-100";
