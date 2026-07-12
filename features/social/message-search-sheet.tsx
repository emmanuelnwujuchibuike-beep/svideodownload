"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { springs } from "@/lib/motion/springs";
import type { SearchResultItem, StarredMessageItem } from "@/lib/social/message-search";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

function snippet(body: string, max = 140): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Part 10 — message search + starred messages, one sheet. Empty query shows
 * your Starred list (the "saved for later" surface); typing switches to live
 * full-text search results across every conversation you're in. Each result
 * links to `/messages/<id>?highlight=<messageId>`, which conversation-room.tsx
 * reads to scroll to + briefly highlight that exact message.
 */
export function MessageSearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [starred, setStarred] = useState<StarredMessageItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setStarred(null);
    void fetch("/api/messages/starred")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStarred(d?.items ?? []))
      .catch(() => setStarred([]));
    // Autofocus after the sheet's own mount/animation, not mid-transition.
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void fetch(`/api/messages/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setResults(d?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  if (!mounted) return null;

  const showingStarred = !query.trim();
  const list: (SearchResultItem | StarredMessageItem)[] = showingStarred ? (starred ?? []) : results;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Search messages">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Search messages</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="relative mx-5 mb-3 block shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search all your chats…"
                aria-label="Search messages"
                className="w-full rounded-2xl border border-border/60 bg-background/60 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
              />
            </label>

            {showingStarred ? (
              <p className="mx-5 mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Star className="h-3.5 w-3.5" /> Starred messages
              </p>
            ) : null}

            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {loading ? (
                <div className="space-y-2 px-2" aria-hidden>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-2xl bg-secondary shimmer" />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    {showingStarred ? <Star className="h-5 w-5" /> : <Search className="h-5 w-5" />}
                  </span>
                  <p className="text-sm font-semibold">{showingStarred ? "No starred messages yet" : `No results for "${query.trim()}"`}</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {showingStarred
                      ? "Long-press any message and choose Star to save it here."
                      : "Try a different word — search only looks at message text, not attachments."}
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {list.map((r) => (
                    <li key={r.messageId}>
                      <Link
                        href={`/messages/${r.conversationId}?highlight=${r.messageId}`}
                        onClick={onClose}
                        className="flex items-start gap-3 rounded-2xl p-3 transition hover:bg-secondary/50"
                      >
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-white",
                            r.conversationAvatarUrl ? "" : "bg-gradient-to-br from-blue-500 to-violet-600",
                          )}
                        >
                          {r.conversationAvatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.conversationAvatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : r.conversationType === "group" ? (
                            <MessageCircle className="h-4 w-4" />
                          ) : (
                            r.conversationLabel.charAt(0).toUpperCase()
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">{r.conversationLabel}</span>
                            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.conversationType === "group" ? `${r.senderName}: ` : ""}
                            {snippet(r.body)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
