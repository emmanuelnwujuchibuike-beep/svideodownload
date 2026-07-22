"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, HardDrive, LogIn, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { GUEST_LIMIT_BYTES, type UsageStats } from "@/features/history/usage";
import { formatBytes } from "@/lib/utils";

/**
 * The 5 GB gate.
 *
 * A signed-out visitor's download history lives on this device and counts
 * against a 5 GB free ceiling (features/history/usage.ts). When they try to
 * download past it, this dialog is the fork the brief asks for: sign in to
 * upgrade to Pro (which lifts the cap and syncs the library across devices), or
 * clear previous history to free the space. It never silently drops a download —
 * the visitor always chooses.
 *
 * Presentation only: the caller owns the "is this guest over the limit"
 * decision (so the same rule guards the paste box and the library page) and
 * passes the two actions in.
 */
export function QuotaGate({
  open,
  usage,
  onClearHistory,
  onClose,
}: {
  open: boolean;
  usage: UsageStats;
  onClearHistory: () => void;
  onClose: () => void;
}) {
  // Escape closes; the page behind is scroll-locked while the dialog is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previous = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[95] flex items-end justify-center p-3 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quota-gate-title"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-elevated"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25">
              <HardDrive className="h-6 w-6" />
            </span>

            <h2 id="quota-gate-title" className="mt-4 text-xl font-bold tracking-[-0.02em]">
              You&apos;ve reached your 5&nbsp;GB free limit
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This device has saved {formatBytes(usage.usedBytes)} across{" "}
              {usage.count === 1 ? "1 download" : `${usage.count} downloads`}. Sign in to upgrade to
              Pro for unlimited storage synced across your devices — or clear your history to keep
              downloading here.
            </p>

            {/* Full meter, so the reason is visible, not just stated. */}
            <div className="mt-4">
              <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600" style={{ width: "100%" }} />
              </div>
              <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {formatBytes(usage.usedBytes)} of {formatBytes(GUEST_LIMIT_BYTES)} used
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <Link
                href="/login?next=/pricing"
                onClick={onClose}
                className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.98]"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <Crown className="h-4 w-4" /> Sign in to upgrade to Pro
              </Link>
              <button
                type="button"
                onClick={() => {
                  onClearHistory();
                  onClose();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border/70 px-5 py-3 text-sm font-semibold text-foreground transition hover:border-rose-500/40 hover:text-rose-500 active:scale-[0.98]"
              >
                <Trash2 className="h-4 w-4" /> Clear history &amp; free up space
              </button>
              <Link
                href="/login"
                onClick={onClose}
                className="mt-0.5 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                <LogIn className="h-3.5 w-3.5" /> Already have an account? Sign in
              </Link>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
