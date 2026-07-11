"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, Download, X } from "lucide-react";
import Link from "next/link";

/**
 * Premium pop-up shown when a Free (incl. signed-out) visitor tries to run a
 * batch download — replaces a plain toast with a real choice: pay for the
 * batch capability, or fall back to the free single-item flow that already
 * works for everyone. Shown identically on the website and the installed
 * webapp (same component, no platform branching needed).
 */
export function BatchUpgradeGate({
  open,
  itemCount,
  onUseSingleDownload,
  onClose,
}: {
  open: boolean;
  itemCount: number;
  onUseSingleDownload: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Batch download is a Pro feature"
      >
        <motion.div
          initial={{ scale: 0.96, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-elevated"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="p-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25">
              <Crown className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-lg font-bold leading-snug">
              Downloading all {itemCount} at once is a Pro feature
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Upgrade to Pro &amp; Above for unlimited batch downloads, high quality and no ads — or keep going free
              and download items one at a time, no sign-up required.
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <Link
                href="/pricing"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:opacity-95 active:scale-[0.99]"
              >
                <Crown className="h-5 w-5" /> Upgrade to Pro
              </Link>
              <button
                type="button"
                onClick={onUseSingleDownload}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-secondary px-4 py-3.5 text-sm font-semibold text-foreground transition hover:bg-secondary/70 active:scale-[0.99]"
              >
                <Download className="h-4 w-4" /> Download one at a time instead
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
