"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Link2, Repeat2, Search, Send, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { loadPeople, PeoplePickerGrid, type Person } from "@/features/social/people-picker";
import { toast } from "@/features/ui/toast";
import { hapticPattern } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

/**
 * The Share sheet — the paper-plane experience (owner spec): send a post to
 * friends as DMs (multi-select + optional message), copy the link, hand off to
 * the OS share sheet, or repost. Bottom sheet on phones, centered card on
 * desktop; blur backdrop; adaptive themes; Esc/backdrop close; loaded lazily
 * (dynamic import) so the feed bundle never pays for it.
 */

export function ShareSheet({
  postId,
  title,
  open,
  onClose,
  onRepost,
}: {
  postId: string;
  title?: string;
  open: boolean;
  onClose: () => void;
  /** When provided, a Repost row appears (opens the existing repost flow). */
  onRepost?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Load recipients when the sheet first opens (cached for reopens).
  useEffect(() => {
    if (!open || people) return;
    let cancelled = false;
    void loadPeople().then((p) => {
      if (!cancelled) setPeople(p);
    });
    return () => {
      cancelled = true;
    };
  }, [open, people]);

  // Fresh state per open + Esc to close.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setNote("");
    setQuery("");
    setSentCount(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const postUrl = () => `${window.location.origin}/p/${postId}`;

  const send = async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/posts/${postId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: [...selected], note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't send.", "error");
        return;
      }
      setSentCount(json.sent as number);
      hapticPattern([10, 40, 10]);
      setTimeout(onClose, 950);
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl());
      toast("Link copied successfully.", "success");
      onClose();
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  const shareExternal = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: title || "Frenz", url: postUrl() });
        onClose();
      } else {
        await copyLink();
      }
    } catch {
      /* user closed the OS sheet */
    }
  };

  // Portaled to <body> — this sheet is `fixed inset-0`, and mounting it
  // wherever the caller happens to sit (a feed card, a reel's action rail…)
  // risks it inheriting an ancestor's `transform`/`overflow-hidden` (feed
  // cards have both), which silently turns "fixed" into "clipped to that
  // card's box" — the exact bug that cut the sheet off at the bottom.
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Share post">
          {/* Backdrop */}
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[82dvh] w-full max-w-lg overflow-hidden rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Success overlay */}
            <AnimatePresence>
              {sentCount !== null ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card"
                >
                  <motion.span
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-lg"
                  >
                    <Check className="h-8 w-8" strokeWidth={3} />
                  </motion.span>
                  <p className="text-sm font-semibold">
                    Sent to {sentCount} {sentCount === 1 ? "person" : "people"}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Share</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3.5 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search people"
                  aria-label="Search people"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* People */}
            <div className="max-h-56 overflow-y-auto px-5 pb-2">
              <PeoplePickerGrid
                people={people}
                query={query}
                selected={selected}
                onToggle={toggle}
                emptyHint="Add friends to send posts privately."
              />
            </div>

            {/* Note + Send (appears once someone is selected) */}
            <AnimatePresence initial={false}>
              {selected.size > 0 ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-border/60"
                >
                  <div className="flex items-center gap-2 px-5 py-3">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 500))}
                      placeholder="Write a message…"
                      aria-label="Message"
                      className="w-full rounded-2xl bg-secondary px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      type="button"
                      onClick={send}
                      disabled={sending}
                      className="bg-brand flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" /> Send{selected.size > 1 ? ` · ${selected.size}` : ""}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Other ways to share */}
            <div className="grid grid-cols-3 gap-2 border-t border-border/60 px-5 py-4">
              <SheetAction icon={Link2} label="Copy link" onClick={copyLink} />
              <SheetAction icon={Share2} label="Share via…" onClick={shareExternal} />
              {onRepost ? (
                <SheetAction
                  icon={Repeat2}
                  label="Repost"
                  onClick={() => {
                    onClose();
                    onRepost();
                  }}
                />
              ) : (
                <SheetAction icon={Copy} label="Copy link" onClick={copyLink} className="invisible" />
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function SheetAction({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-secondary/40 px-2 py-3 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95",
        className,
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
