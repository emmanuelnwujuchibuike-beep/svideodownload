"use client";

import { BarChart3, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

import { PostPoll } from "@/features/social/post-poll";
import type { PollView } from "@/lib/social/polls";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Lazily loads a post's poll (vote) and shows it COMPACT by default — a small
 * one-line chip under the caption — expanding to the full poll only when the
 * viewer taps "See more". Keeps captions clean in the feed, reels, and comments.
 * Only mounted for posts flagged `hasPoll`, so it never fires a needless request.
 */
export function PostPollInline({ postId, loggedIn = true, compact = false }: { postId: string; loggedIn?: boolean; compact?: boolean }) {
  const [poll, setPoll] = useState<PollView | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/posts/${postId}/poll`)
      .then((r) => (r.ok ? r.json() : { poll: null }))
      .then((j: { poll: PollView | null }) => alive && setPoll(j.poll))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [postId]);

  if (!poll) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98]",
          compact
            ? "border-white/20 bg-black/40 text-white backdrop-blur-md hover:bg-black/55"
            : "border-border/60 bg-secondary/50 text-foreground hover:bg-secondary",
        )}
      >
        <BarChart3 className={cn("h-3.5 w-3.5 shrink-0", compact ? "text-white" : "text-primary")} />
        <span className="truncate">{poll.question || "Poll"}</span>
        <span className={cn("shrink-0", compact ? "text-white/70" : "text-muted-foreground")}>
          · {formatCompactNumber(poll.totalVotes)} {poll.totalVotes === 1 ? "vote" : "votes"}
        </span>
        <span className={cn("shrink-0 font-bold", compact ? "text-white" : "text-primary")}>See more</span>
      </button>
    );
  }

  return (
    <div className={cn(compact ? "[&>div]:mt-0 [&>div]:bg-black/40 [&>div]:p-3 [&>div]:backdrop-blur-md" : "[&>div]:mt-0")}>
      <PostPoll initial={poll} loggedIn={loggedIn} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={cn("mt-1.5 inline-flex items-center gap-1 text-xs font-semibold", compact ? "text-white/80" : "text-muted-foreground hover:text-foreground")}
      >
        <ChevronUp className="h-3.5 w-3.5" /> Show less
      </button>
    </div>
  );
}
