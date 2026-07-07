"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, PartyPopper, X } from "lucide-react";

/**
 * Acceptance celebration (Friend Request spec): a glass card with a blue→purple
 * light burst and soft particles — "You and {name} are now friends" — with
 * Start Chat as the primary action. Deliberately brief and elegant, not noisy.
 */
export function FriendCelebration({
  open,
  name,
  onStartChat,
  onClose,
}: {
  open: boolean;
  name: string;
  onStartChat: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`You and ${name} are now friends`}
        >
          <motion.div
            initial={{ scale: 0.85, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-7 text-center shadow-elevated backdrop-blur-xl"
          >
            {/* Electric light waves */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <motion.div
                initial={{ scale: 0.4, opacity: 0.6 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 1.4, ease: "easeOut" }}
                className="absolute left-1/2 top-16 h-40 w-40 -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-500/40 to-violet-500/40 blur-xl"
              />
              <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-blue-500/15 blur-2xl" />
              <div className="absolute -bottom-10 -right-10 h-32 w-32 rounded-full bg-violet-500/15 blur-2xl" />
              {/* Soft particles bursting outward */}
              {PARTICLES.map((p, i) => (
                <motion.span
                  key={i}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
                  transition={{ duration: 1.1, delay: 0.12, ease: "easeOut" }}
                  className={`absolute left-1/2 top-20 h-2 w-2 rounded-full ${p.color}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.08 }}
              className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 shadow-lg shadow-violet-500/30"
            >
              <PartyPopper className="h-8 w-8 text-white" />
            </motion.div>

            <h2 className="relative mt-4 text-lg font-bold tracking-tight">
              You and {name} are now friends
            </h2>
            <p className="relative mt-1 text-sm text-muted-foreground">
              Say hello and start the conversation.
            </p>

            <div className="relative mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={onStartChat}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
              >
                <MessageCircle className="h-4 w-4" /> Start Chat
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl border border-border/70 bg-card py-2.5 text-sm font-semibold transition hover:bg-secondary"
              >
                Maybe later
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const PARTICLES = [
  { x: -90, y: -70, color: "bg-blue-400" },
  { x: 90, y: -60, color: "bg-violet-400" },
  { x: -60, y: 70, color: "bg-fuchsia-400" },
  { x: 70, y: 80, color: "bg-sky-400" },
  { x: -110, y: 10, color: "bg-violet-300" },
  { x: 110, y: 0, color: "bg-blue-300" },
  { x: 0, y: -95, color: "bg-fuchsia-300" },
  { x: 20, y: 95, color: "bg-sky-300" },
];
