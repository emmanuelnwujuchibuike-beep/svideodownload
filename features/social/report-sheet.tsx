"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Flag, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

const REASONS = ["Copyright / DMCA", "Inappropriate", "Spam", "Harassment", "Other"];

/**
 * The real Report flow (Feature 17 Part 14) — category + an optional note,
 * used consistently everywhere something can be reported. Before this, only
 * the standalone post page's `ReportButton` had a category picker at all;
 * the feed card, reel viewer, image viewer, and comments each fired a single
 * hardcoded `reason: "inappropriate"` with zero user input. One real sheet,
 * used everywhere, replacing all of those — not a second parallel UI.
 */
export function ReportSheet({
  targetType,
  targetId,
  open,
  onClose,
  onReported,
}: {
  targetType: "post" | "comment" | "user";
  targetId: string;
  open: boolean;
  onClose: () => void;
  onReported?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => setMounted(true), []);

  const reset = () => {
    setReason(null);
    setNote("");
    setDone(false);
  };

  const close = () => {
    onClose();
    setTimeout(reset, 200); // after the exit animation
  };

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, note: note.trim() || undefined }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      setDone(true);
      onReported?.();
      setTimeout(close, 1200);
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Report">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <Flag className="h-4 w-4 text-red-500" /> Report
              </h3>
              <button type="button" onClick={close} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {done ? (
              <p className="flex items-center gap-2 px-5 py-8 text-sm text-green-500">
                <Check className="h-5 w-5" /> Thanks — we&apos;ll review it.
              </p>
            ) : (
              <div className="px-5 pb-5">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">What&apos;s wrong?</p>
                <div className="mb-4 space-y-1.5">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      aria-pressed={reason === r}
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition",
                        reason === r ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-secondary/15 hover:border-foreground/15",
                      )}
                    >
                      {r}
                      {reason === r ? <Check className="h-4 w-4" /> : null}
                    </button>
                  ))}
                </div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground" htmlFor="report-note">
                  Add details (optional)
                </label>
                <textarea
                  id="report-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="Anything that helps us understand the issue"
                  className="mb-4 w-full resize-none rounded-xl border border-border/60 bg-secondary/15 p-3 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!reason || busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit report
                </button>
              </div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
