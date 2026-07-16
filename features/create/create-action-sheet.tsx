"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clapperboard, Circle, Download, Radio, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { openUpload } from "@/features/create/upload-store";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * The "+" action sheet — built to the owner's mockup
 * (`public/download button menus.jpg`, "Option 1", picked 2026-07-16) exactly:
 * five rows in the mockup's order, each an icon tile + title + one-line hint,
 * over a bottom sheet with a grab handle and a circular close button beneath.
 *
 * Owner: "make the plus button in homepage be exactly like it, no changes …
 * dont simply add everything thats there". So the sheet reproduces the mockup's
 * SHEET, and nothing else from that image — the mockup also renders a whole
 * home screen (stories rail, a feed post, the nav bar), none of which is
 * touched. The nav itself already matches the mockup's five tabs
 * (Home/Friends/+/Chats/Profile), which is the mockup's own point ("Keep the
 * nav") — the only thing that changes is what "+" DOES: it used to open the
 * post composer directly, skipping every other action.
 *
 * Per-row accent colors are the mockup's, not the app's usual brand tile
 * (`bg-brand-tile`): the mockup deliberately color-codes the five actions so
 * they're distinguishable at a glance, and the owner asked for it exactly. They
 * resolve through `/10` tints + a ring so they read correctly in BOTH themes —
 * the mockup is dark-only, but this sheet is not.
 */

type ActionId = "download" | "post" | "reel" | "story" | "live";

interface Action {
  id: ActionId;
  icon: typeof Download;
  label: string;
  hint: string;
  /** Mockup accent — [icon color, tile bg, tile ring]. */
  tone: [string, string, string];
}

const ACTIONS: Action[] = [
  {
    id: "download",
    icon: Download,
    label: "Download Video",
    hint: "Download from any social platform",
    tone: ["text-blue-500 dark:text-blue-400", "bg-blue-500/10", "ring-blue-500/20"],
  },
  {
    id: "post",
    icon: SquarePen,
    label: "Create Post",
    hint: "Share a post with your friends",
    tone: ["text-emerald-500 dark:text-emerald-400", "bg-emerald-500/10", "ring-emerald-500/20"],
  },
  {
    id: "reel",
    icon: Clapperboard,
    label: "Create Reel",
    hint: "Record or upload a short video",
    tone: ["text-violet-500 dark:text-violet-400", "bg-violet-500/10", "ring-violet-500/20"],
  },
  {
    id: "story",
    icon: Circle,
    label: "Story",
    hint: "Share a moment that disappears",
    tone: ["text-amber-500 dark:text-amber-400", "bg-amber-500/10", "ring-amber-500/20"],
  },
  {
    id: "live",
    icon: Radio,
    label: "Go Live",
    hint: "Go live and connect in real-time",
    tone: ["text-rose-500 dark:text-rose-400", "bg-rose-500/10", "ring-rose-500/20"],
  },
];

export function CreateActionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  // Same body-scroll-lock convention every other sheet/viewer uses —
  // `overflowY` only, never the `overflow` shorthand (which would also reset
  // the `overflow-x: clip` that keeps the app's sticky sidebar working). See
  // lib/dom/scroll-lock.ts.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const run = (id: ActionId) => {
    haptic("selection");
    playSound("tap");
    onClose();
    switch (id) {
      case "download":
        // The real downloader for a signed-in viewer: `/` bounces them to
        // /home (app/page.tsx), so /downloads is the only entry that works.
        router.push("/downloads");
        return;
      case "post":
        openUpload("post");
        return;
      case "reel":
        openUpload("reel");
        return;
      case "story":
        openUpload("story");
        return;
      case "live":
        // Owner-confirmed (2026-07-16): "Go Live" is in the mockup but the app
        // has no live feature or backend of any kind, so the row ships exactly
        // as drawn and says so rather than being a button that silently does
        // nothing. Swap this for the real entry point when Live exists.
        toast("Go Live is coming soon.", "info");
        return;
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[130] lg:hidden" role="dialog" aria-modal="true" aria-label="Create">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={springs.sheet}
            className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
          >
            <div className="glass-strong overflow-hidden rounded-3xl border border-border/60 shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.45)]">
              {/* Grab handle (mockup) */}
              <div className="flex justify-center pb-1 pt-2.5">
                <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/15" />
              </div>

              <div className="space-y-2 p-3">
                {ACTIONS.map((a, i) => {
                  const [fg, bg, ring] = a.tone;
                  const Icon = a.icon;
                  return (
                    <motion.button
                      key={a.id}
                      type="button"
                      onClick={() => run(a.id)}
                      // "Lively animation on click" (owner): a real spring
                      // compression, not a CSS opacity fade — same `springs.press`
                      // vocabulary every other control in the app uses.
                      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { ...springs.sheet, delay: 0.03 * i }
                      }
                      className="flex w-full items-center gap-3.5 rounded-2xl border border-border/50 bg-card/60 p-3 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1", bg, ring)}>
                        <Icon className={cn("h-5 w-5", fg)} strokeWidth={a.id === "story" ? 2.5 : 2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{a.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Circular close button beneath the card (mockup) */}
            <div className="flex justify-center pt-3">
              <motion.button
                type="button"
                onClick={onClose}
                aria-label="Close"
                whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                transition={springs.press}
                className="glass-strong flex h-12 w-12 items-center justify-center rounded-full border border-border/60 text-foreground/80 shadow-lg transition-colors hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </motion.button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
