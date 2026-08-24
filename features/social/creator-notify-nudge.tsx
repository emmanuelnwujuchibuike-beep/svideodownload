"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";
import type { CreatorNotificationChannel } from "@/lib/social/creator-notification-channels";
import { cn } from "@/lib/utils";

/**
 * The "turn on notifications for this person?" prompt.
 *
 * Owner, 2026-08-24: "when added or following a pop down promt from top should
 * show a message saying turn on username notification, story, post, live or
 * all."
 *
 * ── Why an imperative singleton rather than local state ────────────────────
 * It has to fire from two unrelated components on two different surfaces
 * (`AddFriendButton` after a request is sent, `FollowButton` after a follow),
 * and it must render at the TOP of the screen regardless of where either of
 * those sits in the tree. That is the same shape `toast()` already solves, so
 * this follows the same subscribe/emit pattern rather than inventing a second
 * one — and the host is mounted alongside `<Toaster />`.
 *
 * ── "Live" is deliberately absent ──────────────────────────────────────────
 * 🔴 The owner's list named "story, post, live or all". There is no live
 * streaming in this app — nothing publishes it, nothing stores it, and no
 * notification type exists for it. A "Live" switch here would be a control
 * that can never fire, which is worse than an absent one: it promises a
 * feature. The three real channels are offered instead. When live ships, add
 * `live` to CREATOR_NOTIFICATION_CHANNELS and it appears here automatically.
 */

interface NudgeRequest {
  userId: string;
  handle: string;
  /** What just happened, so the copy can be specific. */
  reason: "followed" | "requested" | "friended";
}

let current: (NudgeRequest & { key: number }) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Show the prompt. Safe to call from anywhere, including a handler that also
 * navigates — the host lives above the router outlet.
 *
 * Replacing an on-screen prompt rather than queueing: two of these stacked
 * would cover the top of the screen, and the newer relationship is always the
 * one the person is thinking about.
 */
export function promptCreatorNotifications(req: NudgeRequest): void {
  current = { ...req, key: Date.now() };
  emit();
}

function dismiss() {
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => current;
// The server never has a prompt open, and returning a fresh object here would
// loop `useSyncExternalStore` — the same trap the PWA install store hit.
const getServerSnapshot = () => null;

/** Channels offered in the prompt, in the order the owner named them. */
const QUICK: { channels: CreatorNotificationChannel[]; label: string }[] = [
  { channels: ["posts"], label: "Posts" },
  { channels: ["stories"], label: "Stories" },
  { channels: ["posts", "stories", "feed"], label: "All" },
];

/** Mount once, beside `<Toaster />`. */
export function CreatorNotifyNudgeHost() {
  const req = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setMounted(true), []);

  // Auto-dismiss. Long enough to read and act on, short enough that it never
  // becomes furniture. Resets whenever a new prompt replaces this one.
  useEffect(() => {
    if (!req) return;
    setSaved(null);
    setBusy(false);
    const t = window.setTimeout(dismiss, 9000);
    return () => window.clearTimeout(t);
  }, [req]);

  if (!mounted) return null;

  const enable = async (channels: CreatorNotificationChannel[], label: string) => {
    if (!req || busy) return;
    haptic("selection");
    setBusy(true);
    try {
      const body: Partial<Record<CreatorNotificationChannel, boolean>> = {};
      for (const c of channels) body[c] = true;
      const res = await fetch(`/api/creator-notifications/${req.userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSaved(label);
      // Let the confirmation land before it leaves.
      window.setTimeout(dismiss, 1400);
    } catch {
      // Failing silently and closing is right here: this is an optional
      // upsell the person did not ask for, and an error banner about a
      // notification preference would be more disruptive than the miss.
      dismiss();
    } finally {
      setBusy(false);
    }
  };

  const verb =
    req?.reason === "followed" ? "You followed" : req?.reason === "friended" ? "You added" : "Request sent to";

  return createPortal(
    <AnimatePresence>
      {req ? (
        <motion.div
          key={req.key}
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          /*
            Portalled and `fixed`, below the toast layer but above page chrome.
            `--frenz-safe-top` keeps it clear of the notch/dynamic island — the
            same variable every other fixed top element uses.
          */
          className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-3"
          style={{ top: "calc(var(--frenz-safe-top, 0px) + 0.5rem)" }}
          role="status"
        >
          <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-elevated backdrop-blur-xl">
            <div className="flex items-start gap-3 p-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white">
                <Bell className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">
                  {verb} @{req.handle}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {saved ? `${saved} notifications are on.` : "Get notified about their posts and stories?"}
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss"
                className="-mr-0.5 -mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Replaced by the confirmation rather than sitting under it — a row
                of buttons that still looks actionable after the choice is made
                invites a second, pointless tap. */}
            {saved ? (
              <p className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved — change it any time from their profile.
              </p>
            ) : (
              <div className="flex items-center gap-1.5 border-t border-border/60 p-2">
                {QUICK.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => void enable(q.channels, q.label)}
                    disabled={busy}
                    className={cn(
                      "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition active:scale-[0.96] disabled:opacity-60",
                      q.label === "All"
                        ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm"
                        : "bg-secondary text-foreground hover:bg-secondary/70",
                    )}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
