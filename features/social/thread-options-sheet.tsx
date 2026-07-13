"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Clock, Trash2, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { CONVERSATION_THEMES, type ConversationTheme } from "@/lib/social/message-meta";
import { cn } from "@/lib/utils";

const THEME_SWATCH: Record<ConversationTheme, string> = {
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  purple: "bg-violet-500",
};

const DISAPPEAR_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: "Off", seconds: null },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

/**
 * The "…" menu for a DIRECT thread (owner mockup) — groups already have
 * `ThreadHeaderMenu` → `GroupMembersSheet`; this is the direct-thread
 * equivalent: view profile, Chat Theme, Disappearing Messages (+ the new
 * Custom option the mockup adds, alongside the existing Off/24h/7d/30d — the
 * backend for all four already worked, just never exposed outside Secret
 * Chats), and the per-user Delete-conversation hide from the inbox swipe
 * action, reachable from inside the thread too.
 */
export function ThreadOptionsSheet({
  conversationId,
  otherHandle,
  initialTheme,
  initialDisappearAfterSeconds,
  open,
  onClose,
}: {
  conversationId: string;
  otherHandle: string;
  initialTheme: ConversationTheme | null;
  initialDisappearAfterSeconds: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [theme, setTheme] = useState(initialTheme);
  const [disappearAfter, setDisappearAfter] = useState(initialDisappearAfterSeconds);
  const [customDays, setCustomDays] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) toast("Couldn't save that change.", "error");
      else router.refresh();
    } catch {
      toast("Couldn't save that change.", "error");
    } finally {
      setBusy(false);
    }
  };

  const applyTheme = (next: ConversationTheme | null) => {
    haptic("light");
    setTheme(next);
    void patch({ theme: next });
  };

  const applyDisappear = (seconds: number | null) => {
    haptic("light");
    setDisappearAfter(seconds);
    setShowCustom(false);
    void patch({ disappearAfterSeconds: seconds });
  };

  const applyCustomDays = () => {
    const days = Number(customDays);
    if (!Number.isFinite(days) || days <= 0) return;
    applyDisappear(Math.round(days * 86_400));
    setCustomDays("");
  };

  const deleteConversation = async () => {
    if (!window.confirm("Delete this conversation? It'll come back if there's new activity.")) return;
    haptic("selection");
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (res.ok) {
        onClose();
        router.push("/messages");
      } else {
        toast("Couldn't delete this conversation.", "error");
      }
    } catch {
      toast("Couldn't delete this conversation.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Conversation options">
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
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Conversation options</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-5 pb-6 pt-2">
              <Link
                href={`/u/${otherHandle}`}
                onClick={onClose}
                className="flex items-center justify-between rounded-2xl border border-border/60 bg-secondary/20 px-4 py-3 text-sm font-semibold transition hover:bg-secondary/40"
              >
                <span className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" /> View profile
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>

              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">Chat theme</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => applyTheme(null)}
                    aria-label="Default theme"
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border-2 bg-secondary",
                      theme === null ? "border-foreground" : "border-transparent",
                    )}
                  >
                    {theme === null ? <Check className="h-4 w-4" /> : null}
                  </button>
                  {CONVERSATION_THEMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={busy}
                      onClick={() => applyTheme(t)}
                      aria-label={`${t} theme`}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full border-2",
                        THEME_SWATCH[t],
                        theme === t ? "border-foreground" : "border-transparent",
                      )}
                    >
                      {theme === t ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Disappearing messages
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {DISAPPEAR_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      disabled={busy}
                      onClick={() => applyDisappear(o.seconds)}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-medium transition",
                        disappearAfter === o.seconds ? "border-primary bg-primary/10 text-primary" : "border-border/60 hover:bg-secondary/40",
                      )}
                    >
                      {o.label}
                      {disappearAfter === o.seconds ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowCustom((v) => !v)}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-medium transition",
                      showCustom || (disappearAfter !== null && !DISAPPEAR_OPTIONS.some((o) => o.seconds === disappearAfter))
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 hover:bg-secondary/40",
                    )}
                  >
                    Custom
                    {disappearAfter !== null && !DISAPPEAR_OPTIONS.some((o) => o.seconds === disappearAfter) ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                </div>
                {showCustom ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      placeholder="Number of days"
                      className="w-full rounded-xl border border-border/60 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      type="button"
                      onClick={applyCustomDays}
                      disabled={busy || !customDays}
                      className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteConversation()}
                className="flex w-full items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-500 transition hover:bg-red-500/15"
              >
                <Trash2 className="h-4 w-4" /> Delete conversation
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
