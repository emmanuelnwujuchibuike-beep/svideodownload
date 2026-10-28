"use client";

import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * The Friends screens' toast (design/friends, 2026-10-26): dark glass pill above the bottom nav,
 * a gradient tick (or a plain cross for an error), one line, and an optional Undo. Hides itself
 * after 4 s. Portalled to <body> — a `fixed` element inside a blurred ancestor is positioned
 * against THAT ancestor on iOS (the fixed-overlay law), so it never renders in place.
 */

export type FriendsToastMessage = { id: number; text: string; tone?: "ok" | "error"; undo?: () => void };

const HIDE_AFTER_MS = 4000;

export function useFriendsToast() {
  const [toast, setToast] = useState<FriendsToastMessage | null>(null);
  const seq = useRef(0);
  const show = useCallback((text: string, opts: { tone?: "ok" | "error"; undo?: () => void } = {}) => {
    seq.current += 1;
    setToast({ id: seq.current, text, ...opts });
  }, []);
  const hide = useCallback(() => setToast(null), []);
  return { toast, show, hide };
}

export function FriendsToast({ toast, onHide }: { toast: FriendsToastMessage | null; onHide: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onHide, HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [toast, onHide]);

  if (!mounted || !toast) return null;
  return createPortal(
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={cn(
        // 🔴 `!text-white` (owner, 2026-10-28: "this feedback writing is almost invisible"): `.frenz-ui` paints the
        // design's dark ink and was winning over a plain `text-white` on this dark pill. A long error wraps to two lines.
        "frenz-ui frenz-glass-toast fixed inset-x-4 z-[60] mx-auto flex min-h-[52px] max-w-md items-center gap-2.5 rounded-[26px] py-2 pl-4 pr-2 !text-white shadow-[0_18px_40px_-16px_rgb(18_17_26/0.6)]",
        "bottom-[calc(var(--frenz-nav-clearance)+0.75rem)] lg:bottom-6",
        "animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none",
      )}
    >
      <span
        aria-hidden
        className={cn("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full", toast.tone === "error" ? "bg-white/15" : "bg-frenz-gradient-x")}
      >
        {toast.tone === "error" ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 text-[14px] font-bold leading-snug !text-white">{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            onHide();
          }}
          className="h-[38px] shrink-0 rounded-[19px] bg-white/[0.14] px-3.5 text-[13px] font-extrabold transition-transform active:scale-[0.97]"
        >
          Undo
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
