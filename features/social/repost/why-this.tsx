"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Info, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

import { RepostGlyph } from "./repost-glyph";

export interface RepostReasonView {
  kind: string;
  text: string;
  emoji: string;
  detail: string[];
}

/**
 * "Why am I seeing this?" (Feature 15 · Part 4).
 *
 * "Every repost should explain itself. Users should always understand why
 *  content appears."
 *
 * ── The line IS the explanation; the sheet is the long form ──────────────
 * The chip already answers the question ("@chris reposted this"). The sheet
 * exists for the follow-up — WHICH signals put it here — and it is opt-in,
 * because a feed that interrupts to justify itself on every card is worse than
 * one that simply says who recommended it.
 *
 * ── The text is server-produced and never re-derived here ────────────────
 * `reason.ts` builds it from the signals that made the pick. This component
 * renders a string; it has no opinion about ranking and must never acquire one.
 * That is what stops the explanation drifting from the decision.
 *
 * ── Emoji is decorative and stays out of the accessible name ─────────────
 * `text` alone is the label. A screen reader announcing "fire, chris reposted
 * this" is worse than the sentence on its own.
 */
export function WhyThisChip({
  reason,
  className,
  tone = "light",
}: {
  reason: RepostReasonView;
  className?: string;
  /** `dark` for use over media (the reel caption block). */
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${reason.text} Why am I seeing this?`}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition active:scale-[0.98]",
          tone === "dark"
            ? "bg-white/12 text-white/90 ring-1 ring-inset ring-white/20 backdrop-blur-md hover:bg-white/20"
            : "bg-secondary/70 text-muted-foreground ring-1 ring-inset ring-border/60 hover:bg-secondary",
          className,
        )}
      >
        <span aria-hidden className="shrink-0 text-[12px] leading-none">
          {reason.emoji}
        </span>
        <span className="truncate">{reason.text}</span>
        <Info className="h-3 w-3 shrink-0 opacity-60" strokeWidth={2.4} />
      </button>
      <WhyThisSheet reason={reason} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function WhyThisSheet({
  reason,
  open,
  onClose,
}: {
  reason: RepostReasonView;
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { y: 24, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 24, opacity: 0 }}
            transition={springs.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Why am I seeing this?"
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-start gap-3 px-5 pb-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(120deg,#2563eb,#7c3aed)] text-white">
                <RepostGlyph className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <h3 className="min-w-0 flex-1 pt-1 text-sm font-bold leading-snug">Why am I seeing this?</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="px-5 pb-3 pt-2 text-[15px] font-semibold leading-snug">
              <span aria-hidden className="mr-1.5">
                {reason.emoji}
              </span>
              {reason.text}
            </p>

            <ul className="space-y-2 px-5 pb-4">
              {reason.detail.map((line, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-muted-foreground">
                  {/* The last line is always the privacy promise — it gets the
                      shield so it reads as a guarantee rather than as one more
                      ranking factor. */}
                  {i === reason.detail.length - 1 ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.1} />
                  ) : (
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                  )}
                  <span className={cn(i === reason.detail.length - 1 && "text-foreground/80")}>{line}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
