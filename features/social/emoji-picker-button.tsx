"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";

/**
 * A compact, common-emoji grid — the composer's own emoji entry point
 * (previously the only way to send an emoji was typing it, or reacting to an
 * EXISTING message via the reaction bar). Deliberately a flat curated set,
 * not a full categorized/searchable picker — that's a much larger emoji
 * database + virtualized grid; this is the honestly-scoped lightweight v1.
 */
const EMOJI = [
  "😀", "😂", "🥰", "😍", "😊", "😉", "😎", "🤔", "😢", "😭", "😡", "🥳",
  "😴", "🤯", "😱", "🙃", "😇", "🤗", "🤩", "😏", "🙄", "😅", "🤝", "👍",
  "👎", "👏", "🙏", "💪", "👌", "✌️", "🤞", "👋", "❤️", "🧡", "💛", "💚",
  "💙", "💜", "🖤", "🔥", "✨", "🎉", "🎂", "🎁", "💯", "⭐", "☕", "🍕",
  "🚀", "⚡", "🌟", "😮", "😴", "🤷", "🙌", "👀", "💀", "😤", "😬", "🥲",
];

export function EmojiPickerButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  useEffect(() => setMounted(true), []);

  const toggle = () => {
    haptic("light");
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - rect.top + 8, left: Math.max(8, rect.left - 260) });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Emoji"
        className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
      >
        <Smile className="h-5 w-5" />
      </button>
      {mounted && open && pos
        ? createPortal(
            <AnimatePresence>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-[110] cursor-default" />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={springs.bounce}
                style={{ bottom: pos.bottom, left: pos.left }}
                className="glass-strong fixed z-[120] grid w-[280px] grid-cols-8 gap-0.5 rounded-2xl p-2 shadow-elevated"
              >
                {EMOJI.map((e, i) => (
                  <button
                    key={`${e}-${i}`}
                    type="button"
                    onClick={() => {
                      haptic("light");
                      onPick(e);
                      setOpen(false);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-secondary"
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
