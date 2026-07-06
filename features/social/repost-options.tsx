"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Link as LinkIcon, Loader2, MessageSquareQuote, Pencil, Pin, PinOff, Repeat2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { setRepostPinned, toggleRepost } from "@/lib/social/repost-store";
import { cn } from "@/lib/utils";

interface OwnRepost {
  reposted: boolean;
  caption: string | null;
  pinned: boolean;
  edited: boolean;
  editableForMs: number;
}

/**
 * Advanced repost options — opened by HOLDING the Repost button. Before
 * reposting: Quick Repost (instant, no composer) or the caption composer.
 * After: edit the caption (inside the 15-minute grace window), pin/unpin it on
 * the profile Reposts tab, or remove it. Fetches the viewer's own repost row
 * on open so pin/edit state is always current.
 */
export function RepostOptionsSheet({
  postId,
  currentCount,
  open,
  onClose,
  onReposted,
  onCompose,
  onEditCaption,
}: {
  postId: string;
  currentCount: number;
  open: boolean;
  onClose: () => void;
  /** Success burst hook (quick repost path). */
  onReposted?: () => void;
  /** Open the caption composer (create mode). */
  onCompose: () => void;
  /** Open the composer in edit mode with the existing caption. */
  onEditCaption: (caption: string | null) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<OwnRepost | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setState(null);
    fetch(`/api/posts/${postId}/repost`)
      .then((r) => (r.ok ? r.json() : { reposted: false }))
      .then((d) => setState(d as OwnRepost))
      .catch(() => setState({ reposted: false, caption: null, pinned: false, edited: false, editableForMs: 0 }));
  }, [open, postId]);

  const quickRepost = async () => {
    onClose();
    try {
      await toggleRepost(postId, true, currentCount);
      onReposted?.();
      toast("Reposted successfully", "success", {
        duration: 6000,
        action: { label: "Undo", onClick: () => void toggleRepost(postId, false, currentCount + 1).catch(() => {}) },
      });
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't repost.", "error");
    }
  };

  const removeRepost = async () => {
    onClose();
    try {
      await toggleRepost(postId, false, currentCount);
      toast("Removed repost.", "success");
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't remove the repost.", "error");
    }
  };

  const togglePin = async () => {
    if (!state) return;
    onClose();
    try {
      await setRepostPinned(postId, !state.pinned);
      toast(state.pinned ? "Unpinned from your Reposts." : "Pinned to the top of your Reposts.", "success");
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't update the pin.", "error");
    }
  };

  const copyLink = async () => {
    onClose();
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${postId}`);
      toast("Link copied.", "success");
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Repost options">
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
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <Repeat2 className="h-4 w-4 text-emerald-500" /> Repost options
              </h3>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-2.5 pb-2">
              {state === null ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : state.reposted ? (
                <>
                  {state.editableForMs > 0 ? (
                    <OptionRow icon={Pencil} label="Edit caption" hint="Available for 15 minutes after reposting" onClick={() => { onClose(); onEditCaption(state.caption); }} />
                  ) : null}
                  <OptionRow
                    icon={state.pinned ? PinOff : Pin}
                    label={state.pinned ? "Unpin from your Reposts" : "Pin to your Reposts"}
                    hint={state.pinned ? undefined : "Leads your profile's Reposts tab"}
                    onClick={togglePin}
                  />
                  <OptionRow icon={LinkIcon} label="Copy link" onClick={copyLink} />
                  <OptionRow icon={Repeat2} label="Remove repost" danger onClick={removeRepost} />
                </>
              ) : (
                <>
                  <OptionRow icon={Zap} label="Quick Repost" hint="Instantly, without a caption" onClick={quickRepost} />
                  <OptionRow icon={MessageSquareQuote} label="Repost with your thoughts" hint="Say why you're recommending it" onClick={() => { onClose(); onCompose(); }} />
                  <OptionRow icon={LinkIcon} label="Copy link" onClick={copyLink} />
                </>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function OptionRow({
  icon: Icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: typeof Repeat2;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99]",
        danger ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-secondary/70",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-tight">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  );
}
