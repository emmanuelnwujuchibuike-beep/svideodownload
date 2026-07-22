"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, HardDrive, LogIn, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import type { BillingPlan } from "@/lib/monetization/types";
import { formatBytes } from "@/lib/utils";

/**
 * The storage gate.
 *
 * When a visitor tries to download past their plan's ceiling
 * (features/history/usage.ts — 5 GB free, 59 GB Pro, unlimited Business), this
 * dialog is the fork: upgrade, or clear previous history to free the space. It
 * never silently drops a download — the visitor always chooses. The upgrade CTA
 * follows the plan: a guest signs in to go Pro, a signed-in free user goes Pro,
 * a Pro user goes Business.
 *
 * Presentation only: the caller owns the "is this over the limit" decision (so
 * the same rule guards the paste box and the usage page) and passes it in.
 */
function upgradeCta(plan: BillingPlan, signedIn: boolean): { label: string; href: string } {
  if (!signedIn) return { label: "Sign in to upgrade to Pro", href: "/login?next=/pricing" };
  if (plan === "pro") return { label: "Upgrade to Business — unlimited", href: "/pricing" };
  return { label: "Upgrade to Pro", href: "/pricing" };
}

export function QuotaGate({
  open,
  usedBytes,
  count,
  limitBytes,
  plan,
  signedIn,
  onClearHistory,
  onClose,
}: {
  open: boolean;
  usedBytes: number;
  count: number;
  limitBytes: number;
  plan: BillingPlan;
  signedIn: boolean;
  onClearHistory: () => void;
  onClose: () => void;
}) {
  const cta = upgradeCta(plan, signedIn);
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
              You&apos;ve reached your {formatBytes(limitBytes)} limit
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You&apos;ve saved {formatBytes(usedBytes)} across{" "}
              {count === 1 ? "1 download" : `${count} downloads`}. {cta.label} for more storage
              synced across your devices — or clear your history to keep downloading.
            </p>

            {/* Full meter, so the reason is visible, not just stated. */}
            <div className="mt-4">
              <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600" style={{ width: "100%" }} />
              </div>
              <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {formatBytes(usedBytes)} of {formatBytes(limitBytes)} used
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <Link
                href={cta.href}
                onClick={onClose}
                className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.98]"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <Crown className="h-4 w-4" /> {cta.label}
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
              {!signedIn ? (
                <Link
                  href="/login"
                  onClick={onClose}
                  className="mt-0.5 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                >
                  <LogIn className="h-3.5 w-3.5" /> Already have an account? Sign in
                </Link>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
