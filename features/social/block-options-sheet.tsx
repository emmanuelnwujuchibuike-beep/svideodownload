"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ban, MessageCircleOff, Phone, ShieldBan, UserX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

type Scope = "messaging" | "status" | "calls";

interface RestrictionState {
  blocked: boolean;
  messaging: boolean;
  status: boolean;
  calls: boolean;
}

const SCOPE_ROWS: { scope: Scope; icon: typeof MessageCircleOff; label: string; hint: string }[] = [
  { scope: "messaging", icon: MessageCircleOff, label: "Block messages", hint: "They can't send you messages in this chat." },
  { scope: "status", icon: UserX, label: "Hide my status", hint: "They won't see your Stories, and you won't see theirs." },
  { scope: "calls", icon: Phone, label: "Block calls", hint: "Hides voice/video call options between you two." },
];

/**
 * Granular blocking (owner ask, 2026-07-14): "block another user from
 * different ways — chatting with them, watching their status, calls, and
 * others — also include a general blocking option." The three toggles below
 * are independent, additive restrictions (migration 0076 `user_restrictions`)
 * layered underneath the existing full "Block everywhere" (the pre-existing
 * `blocks` table + /api/block/:id, unchanged), which still implies all three
 * plus everything it already did (feed/comments/discovery/profile). Opened
 * from ThreadOptionsSheet, direct/secret threads only — blocking is a 1:1
 * relationship; group-member removal is the existing GroupMembersSheet flow.
 */
export function BlockOptionsSheet({
  open,
  onClose,
  otherUserId,
  otherHandle,
  otherName,
}: {
  open: boolean;
  onClose: () => void;
  otherUserId: string;
  otherHandle: string;
  otherName?: string;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [state, setState] = useState<RestrictionState | null>(null);
  const [busyScope, setBusyScope] = useState<Scope | "all" | null>(null);

  useEffect(() => {
    if (!open) return;
    setState(null);
    let cancelled = false;
    fetch(`/api/block/${otherUserId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setState({ blocked: !!d.blocked, messaging: !!d.messaging, status: !!d.status, calls: !!d.calls });
      })
      .catch(() => {
        if (!cancelled) setState({ blocked: false, messaging: false, status: false, calls: false });
      });
    return () => {
      cancelled = true;
    };
  }, [open, otherUserId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [open]);

  const toggleScope = async (scope: Scope) => {
    if (!state || busyScope) return;
    const next = !state[scope];
    haptic("light");
    setState({ ...state, [scope]: next });
    setBusyScope(scope);
    try {
      const res = await fetch(`/api/block/${otherUserId}`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setState((prev) => (prev ? { ...prev, [scope]: !next } : prev));
      toast("Couldn't save that change.", "error");
    } finally {
      setBusyScope(null);
    }
  };

  const toggleFullBlock = async () => {
    if (!state) return;
    const next = !state.blocked;
    if (next && !window.confirm(`Block @${otherHandle} everywhere? They won't be able to message you, see your posts, or find your profile.`)) return;
    haptic("selection");
    setBusyScope("all");
    try {
      const res = await fetch(`/api/block/${otherUserId}`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      if (!res.ok) throw new Error();
      if (next) {
        toast(`Blocked @${otherHandle}.`, "success");
        onClose();
        router.push("/messages");
        return;
      }
      setState({ ...state, blocked: false });
      toast(`Unblocked @${otherHandle}.`, "success");
    } catch {
      toast("Couldn't save that change.", "error");
    } finally {
      setBusyScope(null);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Block or restrict">
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
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.35)] sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex justify-center pb-1 pt-2.5">
              <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/15" />
            </div>
            <motion.button
              type="button"
              onClick={onClose}
              aria-label="Close"
              whileTap={{ scale: 0.88 }}
              transition={springs.press}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 text-muted-foreground backdrop-blur transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </motion.button>

            <div className="flex flex-col items-center gap-1 px-5 pb-4 pt-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/20">
                <ShieldBan className="h-5 w-5 text-red-500" />
              </span>
              <p className="mt-1.5 text-base font-bold tracking-tight">Block or restrict</p>
              <p className="text-xs text-muted-foreground">{otherName || `@${otherHandle}`} · @{otherHandle}</p>
            </div>

            <div className="space-y-2 px-5 pb-3">
              {SCOPE_ROWS.map((row) => {
                const active = !!state?.[row.scope];
                const Icon = row.icon;
                return (
                  <div key={row.scope} className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/50">
                    <span className="flex min-w-0 items-center gap-3">
                      <ModuleIconBadge icon={Icon} className="h-9 w-9 shrink-0 rounded-xl" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{row.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{row.hint}</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      disabled={!state || busyScope !== null || state.blocked}
                      onClick={() => void toggleScope(row.scope)}
                      className={cn(
                        "relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-40",
                        active ? "bg-primary" : "bg-secondary",
                      )}
                    >
                      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", active ? "translate-x-[18px]" : "translate-x-0.5")} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="px-5 pb-2">
              <div className="my-1 h-px bg-border/60" />
            </div>

            <div className="px-5 pb-6">
              <motion.button
                type="button"
                disabled={!state || busyScope !== null}
                onClick={() => void toggleFullBlock()}
                whileTap={{ scale: 0.98 }}
                transition={springs.press}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold shadow-sm ring-1 transition disabled:opacity-60",
                  state?.blocked
                    ? "bg-secondary text-foreground ring-border/60 hover:bg-secondary/70"
                    : "bg-red-500/10 text-red-500 ring-red-500/20 hover:bg-red-500/15",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/10",
                    state?.blocked ? "bg-foreground/80" : "bg-red-500 shadow-[0_3px_10px_-2px] shadow-red-500/40",
                  )}
                >
                  <Ban className={cn("h-4 w-4", state?.blocked ? "text-background" : "text-white")} />
                </span>
                {state?.blocked ? `Unblock @${otherHandle}` : "Block everywhere"}
              </motion.button>
              {!state?.blocked ? (
                <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
                  Blocks messaging, status, and calls, plus posts, comments, and your profile everywhere else in Frenz.
                </p>
              ) : null}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
