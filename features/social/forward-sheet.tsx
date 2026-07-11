"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { haptic, hapticPattern } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

interface ForwardTarget {
  id: string;
  type: "direct" | "group";
  title: string | null;
  avatarUrl: string | null;
  other: { displayName: string; avatarUrl: string | null } | null;
}

// Same 60s cache convention as people-picker.tsx's loadPeople().
let targetsCache: { at: number; targets: ForwardTarget[] } | null = null;

async function loadTargets(): Promise<ForwardTarget[]> {
  if (targetsCache && Date.now() - targetsCache.at < 60_000) return targetsCache.targets;
  try {
    const res = await fetch("/api/messages");
    const json = res.ok ? await res.json() : null;
    const raw = (json?.conversations ?? []) as ForwardTarget[];
    const targets = raw.map((c) => ({ id: c.id, type: c.type, title: c.title, avatarUrl: c.avatarUrl, other: c.other }));
    targetsCache = { at: Date.now(), targets };
    return targets;
  } catch {
    return [];
  }
}

function targetLabel(t: ForwardTarget): string {
  return t.type === "group" ? t.title || "Group chat" : t.other?.displayName || "Unknown";
}
function targetAvatarUrl(t: ForwardTarget): string | null {
  return t.type === "group" ? t.avatarUrl : (t.other?.avatarUrl ?? null);
}

/**
 * Forward an existing message into other threads — a checkbox list of the
 * user's OWN conversations (direct + group), source thread excluded (you're
 * already looking at it there). Reuses ShareSheet's sheet chrome/portal
 * pattern, but the recipient source is conversations, not people, so it
 * isn't built on the shared PeoplePickerGrid.
 */
export function ForwardSheet({
  messageId,
  excludeConversationId,
  open,
  onClose,
}: {
  messageId: string;
  excludeConversationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || targets) return;
    let cancelled = false;
    void loadTargets().then((t) => {
      if (!cancelled) setTargets(t);
    });
    return () => {
      cancelled = true;
    };
  }, [open, targets]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQuery("");
    setSentCount(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const list = (targets ?? []).filter((t) => t.id !== excludeConversationId);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => targetLabel(t).toLowerCase().includes(q));
  }, [targets, query, excludeConversationId]);

  const toggle = (id: string) => {
    haptic("light");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    if (selected.size === 0 || sending || !messageId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messages/msg/${messageId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't forward.", "error");
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

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Forward message">
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
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[82dvh] w-full max-w-lg overflow-hidden rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
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
                    Forwarded to {sentCount} {sentCount === 1 ? "chat" : "chats"}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Forward message</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3.5 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats"
                  aria-label="Search chats"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto px-2 pb-2">
              {targets === null ? (
                <div className="space-y-1 px-3 py-1" aria-hidden>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <div className="h-11 w-11 rounded-full bg-secondary shimmer" />
                      <div className="h-3 w-32 rounded bg-secondary shimmer" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {targets.length === 0 ? "No conversations to forward to yet." : "No chats match that search."}
                </p>
              ) : (
                filtered.map((t) => {
                  const on = selected.has(t.id);
                  const label = targetLabel(t);
                  const avatarUrl = targetAvatarUrl(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(t.id)}
                      aria-pressed={on}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-secondary/60"
                    >
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                          {label.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
                          on ? "border-violet-500 bg-brand text-white" : "border-border/60 text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={3.5} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <AnimatePresence initial={false}>
              {selected.size > 0 ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-border/60"
                >
                  <div className="flex items-center justify-end px-5 py-3">
                    <button
                      type="button"
                      onClick={send}
                      disabled={sending}
                      className="bg-brand flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" /> Forward{selected.size > 1 ? ` · ${selected.size}` : ""}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
