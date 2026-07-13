"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Comments } from "@/features/social/comments";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import type { CommentNode } from "@/lib/social/engagement";
import { springs } from "@/lib/motion/springs";

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
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<CommentsData | null>(null);
  useEffect(() => setMounted(true), []);

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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Comments">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border/60 bg-card shadow-2xl sm:m-2 sm:h-[80vh] sm:rounded-3xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
              <span className="text-sm font-semibold">Comments</span>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
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
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
