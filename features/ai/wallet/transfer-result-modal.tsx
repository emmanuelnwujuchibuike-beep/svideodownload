"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { haptic, hapticPattern } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

/**
 * The answer to a credits transfer, as a modal (owner, 2026-10-14: "show a
 * successful modal, the green tick should animate on successful, and also make
 * a rejected modal, so users see their credit sent went through").
 *
 * The tick (or cross) is drawn stroke by stroke after the disc springs in, and
 * a soft ring pulses out once. With reduced motion it simply appears.
 */
export type TransferResult =
  | { ok: true; amountLabel: string; feeLabel: string | null; to: string }
  | { ok: false; title: string; message: string; canRetry: boolean };

export function TransferResultModal({ result, z = 140, onDone, onRetry }: { result: TransferResult; z?: number; onDone: () => void; onRetry: () => void }) {
  const still = useReducedMotion();

  useEffect(() => {
    if (result.ok) hapticPattern([12, 60, 18]);
    else haptic("strong");
  }, [result.ok]);

  const tone = result.ok
    ? { disc: "from-emerald-400 to-emerald-600", glow: "rgba(16,185,129,0.55)", ring: "border-emerald-400" }
    : { disc: "from-rose-400 to-rose-600", glow: "rgba(244,63,94,0.5)", ring: "border-rose-400" };
  const draw = still ? { duration: 0 } : { duration: 0.42, ease: "easeOut" as const, delay: 0.18 };

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center px-6" style={{ zIndex: z }} role="alertdialog" aria-modal="true" aria-labelledby="transfer-result-title">
      <motion.button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={result.ok ? onDone : onRetry}
        className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: still ? 0 : 0.18 }}
      />
      <motion.div
        className="relative w-full max-w-[340px] rounded-[28px] bg-card px-6 pb-6 pt-8 text-center shadow-[0_30px_80px_-24px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-black/[0.05] dark:ring-white/10"
        initial={still ? false : { opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={springs.sheet}
      >
        <div className="relative mx-auto h-20 w-20">
          {still ? null : (
            <motion.span
              aria-hidden
              className={cn("absolute inset-0 rounded-full border-2", tone.ring)}
              initial={{ scale: 0.8, opacity: 0.7 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.25 }}
            />
          )}
          <motion.span
            className={cn("absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br text-white", tone.disc)}
            style={{ boxShadow: `0 14px 34px -10px ${tone.glow}` }}
            initial={still ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={springs.bounce}
          >
            <svg viewBox="0 0 52 52" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {result.ok ? (
                <motion.path d="M14 27 l8 8 l16 -18" initial={{ pathLength: still ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw} />
              ) : (
                <>
                  <motion.path d="M17 17 L35 35" initial={{ pathLength: still ? 1 : 0 }} animate={{ pathLength: 1 }} transition={draw} />
                  <motion.path d="M35 17 L17 35" initial={{ pathLength: still ? 1 : 0 }} animate={{ pathLength: 1 }} transition={still ? draw : { ...draw, delay: 0.38 }} />
                </>
              )}
            </svg>
          </motion.span>
        </div>

        {result.ok ? (
          <>
            <h2 id="transfer-result-title" className="mt-5 text-[19px] font-bold tracking-tight">Sent successfully</h2>
            <p className="mt-2 text-[26px] font-extrabold tabular-nums tracking-tight">{result.amountLabel}</p>
            <p className="mt-1 text-[14px] text-muted-foreground">
              to <span className="font-semibold text-foreground">{result.to}</span>
            </p>
            {result.feeLabel ? <p className="mt-2 text-[12px] text-muted-foreground">Transfer fee {result.feeLabel}</p> : null}
            <button
              type="button"
              autoFocus
              onClick={onDone}
              className="mt-6 inline-flex min-h-[3rem] w-full items-center justify-center rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-[15px] font-bold text-white shadow-[0_12px_28px_-14px_rgba(16,185,129,0.9)] transition active:scale-[0.98] motion-reduce:active:scale-100"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <h2 id="transfer-result-title" className="mt-5 text-[19px] font-bold tracking-tight">{result.title}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{result.message}</p>
            <div className="mt-6 flex flex-col gap-2">
              {result.canRetry ? (
                <button
                  type="button"
                  autoFocus
                  onClick={onRetry}
                  className="inline-flex min-h-[3rem] w-full items-center justify-center rounded-full bg-foreground text-[15px] font-bold text-background transition active:scale-[0.98] motion-reduce:active:scale-100"
                >
                  Try again
                </button>
              ) : null}
              <button
                type="button"
                autoFocus={!result.canRetry}
                onClick={onDone}
                className="inline-flex min-h-[3rem] w-full items-center justify-center rounded-full bg-secondary text-[15px] font-semibold transition active:scale-[0.98] motion-reduce:active:scale-100"
              >
                Close
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
