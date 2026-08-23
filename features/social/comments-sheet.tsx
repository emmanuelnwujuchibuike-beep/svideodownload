"use client";

import { ImagePlus, MapPin, Send, Smile, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Comments } from "@/features/social/comments";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { LoadingStripe } from "@/features/ui/page-loader";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import type { CommentNode } from "@/lib/social/engagement";
import { formatCompactNumber } from "@/lib/utils";

interface CommentsData {
  comments: CommentNode[];
  canComment: boolean;
  loggedIn: boolean;
}

/**
 * Comments as their OWN bottom sheet, directly over the feed — tapping the
 * Comment action on a feed card must NOT open the full-screen image/reel
 * viewer (owner: "the comment in feed page dont need to open full screen
 * when user click from the feed without opening the image or post"). Image/
 * reel viewers still have their own inline comments sheet for when a user is
 * already immersed there; this is the separate, lightweight path for a
 * Comment tap straight from the feed.
 */
export function CommentsSheet({
  postId,
  commentsCount,
  open,
  onClose,
}: {
  postId: string;
  commentsCount: number;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<CommentsData | null>(null);

  useEffect(() => {
    if (!open) return;
    prefetchPostComments(postId);
    let cancelled = false;
    void loadPostComments<CommentsData>(postId).then((d) => {
      if (!cancelled && d) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [open, postId]);

  /*
    🔴 REMOVED — GlassSheetShell already does this (owner, laptop view: after
    opening and closing Comments in feed, the page won't scroll until a
    refresh). This effect was a leftover per-caller duplicate of exactly what
    GlassSheetShell's own doc comment says it was built to replace: it set
    `document.body.style.overflowY` directly, GlassSheetShell separately sets
    the `overflow` SHORTHAND — which the CSSOM expands into overflowX/Y, so
    the two were reading and restoring EACH OTHER's values. Whichever
    cleanup ran first captured the OTHER lock's "hidden" as its own "previous"
    value and restored scroll back to locked instead of clearing it. One
    lock (GlassSheetShell's) instead of two racing ones fixes it outright.
  */

  return (
    <GlassSheetShell
      open={open}
      onClose={onClose}
      title={`Comments${commentsCount > 0 ? ` · ${formatCompactNumber(commentsCount)}` : ""}`}
      /*
        🔴 Content-hugging height (owner, 2026-08-18: a post with a single
        comment opened a sheet with a large dead gap under it — "supposed to
        open above very visible professionally and premium"). See
        GlassSheetShell's own note: this sheet now opens exactly as tall as
        its real comment count needs, up to the same ceiling it always had.
      */
      fitContent
    >
      {data ? (
        <Comments
          postId={postId}
          comments={data.comments}
          loggedIn={data.loggedIn}
          canComment={data.canComment}
          disabledReason={data.canComment ? null : "Comments are unavailable."}
          count={commentsCount}
          variant="sheet"
        />
      ) : (
        <CommentsLoadingPlaceholder />
      )}
    </GlassSheetShell>
  );
}

/*
 * 🔴 Loading state (owner, 2026-08-18: "make the comment to open faster...
 * it should show this top section of the comment while showing a blue strip
 * loading beneath the top section... the loading should only be in bad
 * network otherwise it should never load[s]").
 *
 * On a decent connection this should never actually be SEEN: feed-post-
 * card.tsx now prefetches a post's comments as its card nears the viewport
 * (the same intersection-observer head-start FeedImage already uses for its
 * media), so by the time someone taps Comment, `loadPostComments` below
 * almost always resolves from the warm cache — near-instant, no loading
 * frame ever painted. This only renders on a genuine cache miss (a fast
 * scroll straight to Comment, a cold cache, a slow/bad connection), and even
 * then shows the composer's own chrome immediately (matching the real one in
 * comments.tsx exactly, so nothing visibly swaps shape once data lands)
 * instead of a bare "Loading…" centered in dead space.
 */
function CommentsLoadingPlaceholder() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex items-center gap-1 rounded-3xl border border-border/60 bg-card/70 p-2 opacity-60 shadow-soft backdrop-blur-xl">
        <span className="shrink-0 rounded-full p-2 text-muted-foreground"><Smile className="h-5 w-5" /></span>
        <span className="shrink-0 rounded-full p-2 text-muted-foreground"><ImagePlus className="h-5 w-5" /></span>
        <span className="shrink-0 rounded-full p-2 text-muted-foreground"><Sparkles className="h-5 w-5" /></span>
        <span className="hidden shrink-0 rounded-full p-2 text-muted-foreground sm:inline-flex"><MapPin className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1 py-1.5 text-sm text-muted-foreground/70">Add a comment…</span>
        <span className="shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white">
          <Send className="h-5 w-5" />
        </span>
      </div>
      <LoadingStripe />
    </div>
  );
}
