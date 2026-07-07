"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Link2, Repeat2, Search, Send, Share2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

/**
 * The Share sheet — the paper-plane experience (owner spec): send a post to
 * friends as DMs (multi-select + optional message), copy the link, hand off to
 * the OS share sheet, or repost. Bottom sheet on phones, centered card on
 * desktop; blur backdrop; adaptive themes; Esc/backdrop close; loaded lazily
 * (dynamic import) so the feed bundle never pays for it.
 */

interface Person {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

// Recents + friends, module-cached briefly so reopening the sheet is instant.
let peopleCache: { at: number; people: Person[] } | null = null;

async function loadPeople(): Promise<Person[]> {
  if (peopleCache && Date.now() - peopleCache.at < 60_000) return peopleCache.people;
  const seen = new Set<string>();
  const people: Person[] = [];
  const add = (p: Person | null | undefined) => {
    if (p?.id && p.handle && !seen.has(p.id)) {
      seen.add(p.id);
      people.push(p);
    }
  };
  // Recent chats first (most likely recipients), then friends.
  const [convRes, friendRes] = await Promise.allSettled([
    fetch("/api/messages").then((r) => (r.ok ? r.json() : null)),
    fetch("/api/friends").then((r) => (r.ok ? r.json() : null)),
  ]);
  if (convRes.status === "fulfilled" && convRes.value?.conversations) {
    for (const c of convRes.value.conversations as { other: Person | null }[]) add(c.other);
  }
  if (friendRes.status === "fulfilled" && friendRes.value?.friends) {
    for (const f of friendRes.value.friends as { user: Person }[]) add(f.user);
  }
  peopleCache = { at: Date.now(), people };
  return people;
}

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

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q),
    );
  }, [people, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      navigator.vibrate?.(6);
    } catch {
      /* no haptics */
    }
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
      try {
        navigator.vibrate?.([10, 40, 10]);
      } catch {
        /* no haptics */
      }
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

  return (
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
            transition={{ type: "spring", stiffness: 420, damping: 42 }}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[82dvh] w-full max-w-lg overflow-hidden rounded-t-3xl border border-border/60 bg-card shadow-2xl sm:bottom-6 sm:rounded-3xl"
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
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg"
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
              {people === null ? (
                <div className="grid grid-cols-4 gap-3 py-1" aria-hidden>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex flex-col items-center gap-1.5">
                      <div className="h-14 w-14 rounded-full bg-secondary shimmer" />
                      <div className="h-2.5 w-12 rounded bg-secondary shimmer" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {people.length === 0 ? "Add friends to send posts privately." : "No one matches that search."}
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-3 py-1">
                  {filtered.slice(0, 24).map((p) => {
                    const on = selected.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        aria-label={`Send to ${p.displayName}`}
                        className="group flex flex-col items-center gap-1.5"
                      >
                        <span className={cn("relative rounded-full p-[2px] transition", on ? "bg-gradient-to-br from-blue-600 to-violet-600" : "bg-transparent")}>
                          {p.avatarUrl ? (
                            <Image src={p.avatarUrl} alt="" width={56} height={56} className="h-14 w-14 rounded-full object-cover ring-2 ring-card" />
                          ) : (
                            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white ring-2 ring-card">
                              {p.displayName.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <AnimatePresence>
                            {on ? (
                              <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                transition={{ type: "spring", stiffness: 500, damping: 24 }}
                                className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-card"
                              >
                                <Check className="h-3 w-3" strokeWidth={3.5} />
                              </motion.span>
                            ) : null}
                          </AnimatePresence>
                        </span>
                        <span className="max-w-[4.5rem] truncate text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                          {p.displayName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
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
                      className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-60"
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
    </AnimatePresence>
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
