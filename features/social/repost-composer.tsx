"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Loader2, Repeat2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { editRepostCaption, toggleRepost } from "@/lib/social/repost-store";
import { cn } from "@/lib/utils";

const CAPTION_MAX = 300;
const draftKey = (postId: string) => `frenz:repost-draft:${postId}`;

export interface RepostComposerPost {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  publisher: { handle: string; displayName: string; avatarUrl: string | null; isVerified?: boolean };
}

/**
 * The repost composer — reposting is a recommendation, never a one-tap
 * accident. Opens as a premium bottom sheet with the original creator's
 * preview and an OPTIONAL "why are you recommending this?" caption; Post Now
 * works instantly with or without one. The caption belongs to the reposter —
 * the original post is never modified. Drafts auto-save per post (localStorage)
 * so an accidental dismiss loses nothing; posting clears the draft. After
 * posting, an Undo toast keeps the action reversible for a few seconds.
 */
export function RepostComposer({
  post,
  currentCount,
  open,
  onClose,
  onReposted,
  mode = "create",
  initialCaption = null,
}: {
  post: RepostComposerPost;
  currentCount: number;
  open: boolean;
  onClose: () => void;
  /** Fires on success (after the optimistic store update) — e.g. the burst animation. */
  onReposted?: () => void;
  /** "edit" reuses the sheet to change an existing repost's caption (15-min window). */
  mode?: "create" | "edit";
  initialCaption?: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editing = mode === "edit";

  useEffect(() => setMounted(true), []);

  // Restore the draft (create) or the live caption (edit) when opening; focus
  // the caption (spec: auto-focus).
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCaption(initialCaption ?? "");
    } else {
      try {
        setCaption(localStorage.getItem(draftKey(post.id)) ?? "");
      } catch {
        setCaption("");
      }
    }
    const t = setTimeout(() => textareaRef.current?.focus(), 220); // after the spring settles
    return () => clearTimeout(t);
  }, [open, post.id, editing, initialCaption]);

  // Draft auto-save (and cleanup when emptied) — create mode only.
  useEffect(() => {
    if (!open || editing) return;
    try {
      if (caption.trim()) localStorage.setItem(draftKey(post.id), caption);
      else localStorage.removeItem(draftKey(post.id));
    } catch {
      /* ignore */
    }
  }, [caption, open, post.id, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const postNow = async () => {
    if (posting) return;
    setPosting(true);
    const text = caption.trim().slice(0, CAPTION_MAX) || null;
    try {
      if (editing) {
        await editRepostCaption(post.id, text);
        onClose();
        toast("Caption updated.", "success");
        return;
      }
      await toggleRepost(post.id, true, currentCount, text);
      try {
        localStorage.removeItem(draftKey(post.id));
      } catch {
        /* ignore */
      }
      onReposted?.();
      onClose();
      toast("Reposted successfully", "success", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            void toggleRepost(post.id, false, currentCount + 1).catch(() => {});
          },
        },
      });
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : (editing ? "Couldn't update the caption." : "Couldn't repost."), "error");
    } finally {
      setPosting(false);
    }
  };

  if (!mounted) return null;
  const remaining = CAPTION_MAX - caption.length;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Repost">
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
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <Repeat2 className="h-4 w-4 text-emerald-500" /> {editing ? "Edit caption" : "Repost"}
              </h3>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 pb-4">
              {/* Caption — the recommendation, owned by the reposter */}
              <textarea
                ref={textareaRef}
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
                placeholder="Why are you recommending this? (Optional)"
                rows={3}
                maxLength={CAPTION_MAX}
                className="w-full resize-none rounded-2xl border border-border/60 bg-secondary/40 p-3.5 text-[15px] leading-relaxed outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
              <div className="mt-1 flex justify-end">
                <span
                  aria-live="polite"
                  className={cn("text-[11px] tabular-nums", remaining <= 20 ? "font-semibold text-amber-500" : "text-muted-foreground")}
                >
                  {remaining}
                </span>
              </div>

              {/* Original content preview — attribution is the whole point */}
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/30 p-3">
                {post.thumbnailUrl ? (
                  <Image src={post.thumbnailUrl} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : post.publisher.avatarUrl ? (
                  <Image src={post.publisher.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white">
                    {post.publisher.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-semibold leading-tight">
                    <span className="truncate">{post.publisher.displayName}</span>
                    {post.publisher.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">@{post.publisher.handle}</p>
                  {post.title ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{post.title}</p> : null}
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Reposting shares this with your followers. The original creator keeps full ownership and credit.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={postNow}
                  disabled={posting}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat2 className="h-4 w-4" />} {editing ? "Save" : "Post Now"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
