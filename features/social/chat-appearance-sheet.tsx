"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import {
  BUBBLE_STYLES,
  BUBBLE_STYLE_LABEL,
  BUBBLE_STYLE_SHAPE,
  FONT_SIZES,
  FONT_SIZE_LABEL,
  FONT_SIZE_TEXT_CLASS,
} from "@/lib/social/chat-appearance";
import { cn } from "@/lib/utils";
import { setChatAppearance, useChatAppearance } from "@/features/social/use-chat-appearance";

/** Curated, premium-feeling swatches — not a raw `<input type=color>` wheel
 *  first (that's tucked behind "Custom"), matching how every other picker in
 *  this app (Chat Theme's 5 swatches, wallpaper) leads with a tasteful preset
 *  set. */
const COLOR_SWATCHES = ["#0A84FF", "#6C4DFF", "#22C55E", "#F97316", "#EC4899", "#14B8A6", "#EF4444", "#64748B"];

/**
 * Personal chat appearance — font size + bubble style/color (owner ask,
 * 2026-07-14: "user can set up text font size and it reflect in both chats,
 * set chat bubble styles and color"). Deliberately per-VIEWER (see
 * lib/social/chat-appearance.ts's doc comment) — applies instantly across
 * every conversation the moment a choice is made, via the shared
 * stale-while-revalidate cache (useChatAppearance/setChatAppearance), not
 * just this one thread. Leads with a live 2-bubble preview so a choice is
 * never made blind.
 */
export function ChatAppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const appearance = useChatAppearance();
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [open]);

  const shape = BUBBLE_STYLE_SHAPE[appearance.bubbleStyle];
  const mineStyle = appearance.bubbleColor ? { backgroundColor: appearance.bubbleColor } : undefined;

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Font size and bubble style">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.35)] sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex justify-center pb-1 pt-2.5">
              <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/15" />
            </div>
            <motion.button
              type="button"
              onClick={onClose}
              aria-label="Close"
              whileTap={{ scale: 0.88 }}
              transition={springs.press}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 text-muted-foreground backdrop-blur transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </motion.button>

            <div className="flex flex-col items-center gap-1 px-5 pb-4 pt-2 text-center">
              <ModuleIconBadge icon={Sparkles} tone="vivid" className="h-12 w-12 rounded-2xl" />
              <p className="mt-1.5 text-base font-bold tracking-tight">Font size & bubble style</p>
              <p className="text-xs text-muted-foreground">Personal to you — applies across every chat.</p>
            </div>

            {/* Live preview — mirrors conversation-room.tsx's real bubble
                markup (same rounded/tail classes, same text-size scale) so
                what's shown here is exactly what a real thread will look
                like, not an approximation. */}
            <div className="mx-5 mb-5 space-y-1.5 rounded-2xl bg-secondary/30 p-4">
              <div className="flex flex-col items-start">
                <div className={cn("glass max-w-[75%] px-4 py-2.5 leading-relaxed text-foreground shadow-sm", shape.base, shape.tailTheirs, FONT_SIZE_TEXT_CLASS[appearance.fontSize])}>
                  Hey! How&apos;s it going? 👋
                </div>
              </div>
              <div className="flex flex-col items-end">
                <div
                  style={mineStyle}
                  className={cn("bg-brand max-w-[75%] px-4 py-2.5 leading-relaxed text-white shadow-md shadow-violet-500/20", shape.base, shape.tailMine, FONT_SIZE_TEXT_CLASS[appearance.fontSize])}
                >
                  Doing great, thanks!
                </div>
              </div>
            </div>

            <div className="space-y-4 px-5 pb-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Font size</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {FONT_SIZES.map((size) => {
                    const active = appearance.fontSize === size;
                    return (
                      <motion.button
                        key={size}
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        transition={springs.press}
                        onClick={() => {
                          haptic("light");
                          void setChatAppearance({ fontSize: size });
                        }}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center text-[11px] font-medium transition",
                          active ? "border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/30" : "border-border/60 text-muted-foreground hover:bg-secondary/40",
                        )}
                      >
                        <span className={cn("font-bold", FONT_SIZE_TEXT_CLASS[size])}>Aa</span>
                        {FONT_SIZE_LABEL[size]}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bubble style</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {BUBBLE_STYLES.map((style) => {
                    const active = appearance.bubbleStyle === style;
                    const s = BUBBLE_STYLE_SHAPE[style];
                    return (
                      <motion.button
                        key={style}
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        transition={springs.press}
                        onClick={() => {
                          haptic("light");
                          void setChatAppearance({ bubbleStyle: style });
                        }}
                        className={cn(
                          "flex flex-col items-center gap-2 rounded-xl border px-1 py-2.5 text-center text-[11px] font-medium transition",
                          active ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:bg-secondary/40",
                        )}
                      >
                        <span className={cn("h-4 w-8 bg-foreground/70", s.base)} />
                        {BUBBLE_STYLE_LABEL[style]}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bubble color</p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <motion.button
                    type="button"
                    aria-label="Default"
                    whileTap={{ scale: 0.88 }}
                    animate={!appearance.bubbleColor ? { scale: 1.08 } : { scale: 1 }}
                    transition={springs.bounce}
                    onClick={() => {
                      haptic("light");
                      void setChatAppearance({ bubbleColor: null });
                    }}
                    className={cn(
                      "bg-brand relative flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                      !appearance.bubbleColor ? "shadow-lg shadow-foreground/20 ring-foreground" : "ring-transparent",
                    )}
                  >
                    {!appearance.bubbleColor ? <Check className="h-4 w-4 text-white" /> : null}
                  </motion.button>
                  {COLOR_SWATCHES.map((hex) => {
                    const active = appearance.bubbleColor === hex;
                    return (
                      <motion.button
                        key={hex}
                        type="button"
                        aria-label={hex}
                        whileTap={{ scale: 0.88 }}
                        animate={active ? { scale: 1.08 } : { scale: 1 }}
                        transition={springs.bounce}
                        onClick={() => {
                          haptic("light");
                          void setChatAppearance({ bubbleColor: hex });
                        }}
                        style={{ backgroundColor: hex }}
                        className={cn(
                          "relative flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                          active ? "shadow-lg shadow-foreground/20 ring-foreground" : "ring-transparent",
                        )}
                      >
                        {active ? <Check className="h-4 w-4 text-white" /> : null}
                      </motion.button>
                    );
                  })}
                  <motion.button
                    type="button"
                    aria-label="Custom color"
                    whileTap={{ scale: 0.88 }}
                    onClick={() => {
                      haptic("light");
                      colorInputRef.current?.click();
                    }}
                    className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground transition hover:bg-secondary/40"
                  >
                    <span className="text-base leading-none">+</span>
                  </motion.button>
                  <input
                    ref={colorInputRef}
                    type="color"
                    className="sr-only"
                    value={appearance.bubbleColor ?? "#0A84FF"}
                    onChange={(e) => void setChatAppearance({ bubbleColor: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
