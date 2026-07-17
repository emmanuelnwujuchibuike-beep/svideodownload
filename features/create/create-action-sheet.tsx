"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clapperboard, Circle, Download, Radio, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createPortal } from "react-dom";

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
 * Icon treatment, owner correction (2026-07-16): "remove all blue icon back
 * from all pages, most especially the message, chat, chat option and download,
 * and all to a whatsapp ios app kind of emoji without background color, and
 * make the icon have high icon contrast to be darker."
 *
 * The mockup color-coded these five rows with tinted tiles (Download was the
 * blue one named in that correction), and this sheet reproduced them exactly.
 * That instruction supersedes it: the tiles are gone and each row is now a
 * bare, full-contrast `text-foreground` glyph, matching every other icon in
 * the app after the same pass. The mockup's ROWS — order, labels, one-line
 * hints, sheet shape, grab handle, circular close beneath — are untouched.
 */

type ActionId = "download" | "post" | "reel" | "story" | "live";

interface Action {
  id: ActionId;
  icon: typeof Download;
  label: string;
  hint: string;
}

const ACTIONS: Action[] = [
  { id: "download", icon: Download, label: "Download Video", hint: "Download from any social platform" },
  { id: "post", icon: SquarePen, label: "Create Post", hint: "Share a post with your friends" },
  { id: "reel", icon: Clapperboard, label: "Create Reel", hint: "Record or upload a short video" },
  { id: "story", icon: Circle, label: "Story", hint: "Share a moment that disappears" },
  { id: "live", icon: Radio, label: "Go Live", hint: "Go live and connect in real-time" },
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

  // The create surfaces are real routes now, so warm them the moment the sheet
  // opens — by the time a row is tapped the chunk is already there and it
  // opens straight into the surface, no navigation wait. Intent is real here
  // (the sheet is open), so this isn't speculative bandwidth the way an
  // unconditional prefetch would be.
  useEffect(() => {
    if (!open) return;
    for (const r of ["/create/post", "/create/reel", "/create/story", "/downloads"]) router.prefetch(r);
  }, [open, router]);

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
      // Each row opens its OWN create surface (owner, 2026-07-16). Post, Reel
      // and Story used to all open one shared composer that then had to be
      // re-steered to the destination the user had already picked here.
      case "post":
        router.push("/create/post");
        return;
      case "reel":
        router.push("/create/reel");
        return;
      case "story":
        router.push("/create/story");
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
            // onPointerDown, not onClick — see media-composer-sheet.tsx's
            // backdrop for why `click` gets swallowed on touch.
            onPointerDown={onClose}
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
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center text-foreground">
                        <Icon className="h-[22px] w-[22px]" strokeWidth={a.id === "story" ? 2.5 : 2} />
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
