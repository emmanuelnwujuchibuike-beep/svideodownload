"use client";

import { useEffect, useState } from "react";

import { Comments } from "@/features/social/comments";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
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
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
      )}
    </GlassSheetShell>
  );
}
