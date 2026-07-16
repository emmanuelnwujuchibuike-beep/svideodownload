"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clapperboard, Circle, Loader2, MessageCircle, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { playSound } from "@/lib/notifications/sound-fx";
import { ALLOWED_DESTINATIONS, type ReshareDestination, type ReshareSource } from "@/lib/social/reshare-rules";
import { cn } from "@/lib/utils";

/**
 * The reshare sheet — one surface for both entry points (chat media and a
 * story), with its rows driven by the SAME `ALLOWED_DESTINATIONS` table the
 * server enforces. That's deliberate: the owner's rule that a story goes "to
 * their own stories or private chat no where else" is then true in the UI and
 * on the server for one reason, not two that can drift apart.
 *
 * Reels only ever appears for a video — a photo can't be a Reel (the same
 * product rule /create/reel and /api/stories already hold).
 */

const ROW: Record<ReshareDestination, { label: string; hint: string; icon: typeof Sparkles }> = {
  post: { label: "Feed", hint: "Share as a post on your profile", icon: Sparkles },
  reel: { label: "Reel", hint: "Share as a full-screen reel", icon: Clapperboard },
  story: { label: "Your story", hint: "Disappears in 24 hours", icon: Circle },
  chat: { label: "Send in chat", hint: "Forward privately to a friend", icon: MessageCircle },
};

export function ReshareSheet({
  open,
  onClose,
  source,
  sourceId,
  attachmentId,
  mediaKind,
  previewUrl,
}: {
  open: boolean;
  onClose: () => void;
  source: ReshareSource;
  sourceId: string;
  attachmentId?: string;
  mediaKind: "image" | "video";
  previewUrl?: string | null;
}) {
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState<ReshareDestination | null>(null);
  // "Send in chat" needs a conversation, so the sheet has a second step rather
  // than handing off to ForwardSheet — that one forwards an existing MESSAGE by
  // id and has no notion of a story.
  const [pickingChat, setPickingChat] = useState(false);
  const { data: inbox } = useQuery<Inbox>(INBOX_KEY, loadInbox);

  useEffect(() => {
    if (!open) return;
    setPickingChat(false);
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // A photo can never be a Reel.
  const destinations = ALLOWED_DESTINATIONS[source].filter((d) => d !== "reel" || mediaKind === "video");

  const run = async (destination: ReshareDestination, conversationId?: string) => {
    haptic("selection");
    playSound("tap");
    if (destination === "chat" && !conversationId) {
      setPickingChat(true);
      return;
    }
    setBusy(destination);
    try {
      const res = await fetch("/api/reshare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, sourceId, attachmentId, destination, conversationId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        // The server is the authority here — an author who turned resharing off
        // after this sheet opened is caught by THIS response, not by the rows.
        toast(json.error ?? "Couldn't reshare.", "error");
        return;
      }
      toast(
        destination === "story"
          ? "Shared to your story"
          : destination === "reel"
            ? "Your reel is live"
            : destination === "chat"
              ? "Sent"
              : "Posted to your feed",
        "success",
      );
      onClose();
    } catch {
      toast("Network error.", "error");
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Reshare">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={springs.sheet}
            className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
          >
            <div className="glass-strong overflow-hidden rounded-3xl border border-border/60 shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.45)]">
              <div className="flex justify-center pb-1 pt-2.5">
                <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/15" />
              </div>

              <div className="flex items-center gap-3 px-4 pb-1 pt-1">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                ) : null}
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">{pickingChat ? "Send to…" : "Reshare"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {pickingChat
                      ? "Pick a chat"
                      : source === "story"
                        ? "Stories can go to your story or a private chat"
                        : "Share this media on your profile"}
                  </p>
                </div>
              </div>

              {pickingChat ? (
                <div className="max-h-[46vh] space-y-1 overflow-y-auto p-3">
                  {(inbox?.conversations ?? []).length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">No chats yet.</p>
                  ) : (
                    (inbox?.conversations ?? []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run("chat", c.id)}
                        className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-secondary/60 disabled:opacity-60"
                      >
                        {c.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-foreground">
                            {(c.title || "?").charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{c.title}</span>
                        {busy === "chat" ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-2 p-3">
                  {destinations.map((d, i) => {
                    const Icon = ROW[d].icon;
                    return (
                      <motion.button
                        key={d}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run(d)}
                        whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { ...springs.sheet, delay: 0.03 * i }}
                        className="flex w-full items-center gap-3.5 rounded-2xl border border-border/50 bg-card/60 p-3 text-left transition-colors hover:bg-secondary/60 disabled:opacity-60"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center text-foreground">
                          {busy === d ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-[22px] w-[22px]" strokeWidth={d === "story" ? 2.5 : 2} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-foreground">{ROW[d].label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{ROW[d].hint}</span>
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-center pt-3">
              <motion.button
                type="button"
                onClick={onClose}
                aria-label="Close"
                whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                transition={springs.press}
                className={cn(
                  "glass-strong flex h-12 w-12 items-center justify-center rounded-full border border-border/60 text-foreground/80 shadow-lg transition-colors hover:text-foreground",
                )}
              >
                <X className="h-5 w-5" />
              </motion.button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
