"use client";

import { useEffect, useState } from "react";

import { PostPoll } from "@/features/social/post-poll";
import type { PollView } from "@/lib/social/polls";

/**
 * Lazily loads + renders a post's poll (vote) inline — under the caption in the
 * feed/reels and atop the comments. Only mounted for posts flagged `hasPoll`, so
 * it never fires a request for postless posts.
 */
export function PostPollInline({ postId, loggedIn = true, compact = false }: { postId: string; loggedIn?: boolean; compact?: boolean }) {
  const [poll, setPoll] = useState<PollView | null>(null);
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
  return (
    <div className={compact ? "[&>div]:mt-0 [&>div]:bg-black/40 [&>div]:p-3 [&>div]:backdrop-blur-md" : "[&>div]:mt-0"}>
      <PostPoll initial={poll} loggedIn={loggedIn} />
    </div>
  );
}
