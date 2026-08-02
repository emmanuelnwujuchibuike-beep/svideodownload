"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import { useSyncExternalStore } from "react";

import { springs } from "@/lib/motion/springs";

import { setAppMode } from "./use-app-mode";

/**
 * The "Switch to Full Bleed" prompt. In Downloader mode a signed-in user can share
 * downloads, like, view and comment, but chatting and uploading from the gallery
 * belong to the full experience (owner) — those entry points call
 * `promptFullBleed("<action>")` to offer a one-tap switch instead of opening.
 *
 * A tiny module store drives one shared modal mounted in the app shell, so any
 * gated control anywhere can trigger it without prop-drilling.
 */
let reason: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Open the prompt. `action` is a short label, e.g. "Chatting". */
export function promptFullBleed(action: string): void {
  reason = action;
  emit();
}
function close() {
  reason = null;
  emit();
}
function useReason(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => reason,
    () => null,
  );
}

export function SwitchModePrompt() {
  const r = useReason();
  return (
    <AnimatePresence>
      {r ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative m-3 w-full max-w-sm rounded-3xl border border-border/60 bg-card p-6 text-center shadow-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          >
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/30">
              <LayoutGrid className="h-7 w-7" />
            </span>
            <h2 className="text-lg font-bold tracking-tight">Switch to Full Bleed</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {r} is part of the full Frenz experience. Switch to Full Bleed to use it — you can switch back to
              Downloader anytime from your profile.
            </p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={close} className="flex-1 rounded-2xl bg-secondary py-3 text-sm font-semibold text-foreground transition hover:bg-secondary/70 active:scale-[0.98]">
                Not now
              </button>
              <button type="button" onClick={() => setAppMode("full")} className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 py-3 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.98]">
                Switch
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
