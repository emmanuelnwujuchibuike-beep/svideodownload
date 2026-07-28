"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ban, Check, Link2, Loader2, MoreHorizontal, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Overflow menu on a profile: copy link + block/unblock. On mobile it opens as a
 * bottom sheet (portaled to <body> so it escapes the glass card's backdrop-blur
 * containing block — otherwise a fixed/absolute menu clips off-screen); on desktop
 * it's a right-aligned dropdown. Shown to signed-in viewers on other profiles.
 */
export function ProfileActions({
  targetId,
  handle,
  initialBlocked,
}: {
  targetId: string;
  handle: string;
  initialBlocked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(initialBlocked);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const copy = () => {
    navigator.clipboard
      ?.writeText(`${window.location.origin}/u/${handle}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const toggleBlock = async () => {
    if (busy) return;
    setBusy(true);
    const next = !blocked;
    try {
      const res = await fetch(`/api/block/${targetId}`, { method: next ? "POST" : "DELETE" });
      if (res.ok) {
        setBlocked(next);
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const rowCls = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition hover:bg-secondary";
  const items = (
    <>
      <button type="button" role="menuitem" onClick={copy} className={rowCls}>
        {copied ? <Check className="h-[18px] w-[18px] text-green-500" /> : <Link2 className="h-[18px] w-[18px]" />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <button type="button" role="menuitem" onClick={toggleBlock} disabled={busy} className={`${rowCls} text-red-500 hover:bg-red-500/10 disabled:opacity-60`}>
        {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : blocked ? <ShieldOff className="h-[18px] w-[18px]" /> : <Ban className="h-[18px] w-[18px]" />}
        {blocked ? "Unblock" : "Block"}
      </button>
    </>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        className="btn-lux-icon"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {/* Desktop dropdown */}
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 hidden w-48 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated sm:block">
          {items}
        </div>
      ) : null}

      {/* Mobile bottom sheet — portaled so backdrop-blur ancestors can't clip it */}
      {mounted
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <div className="sm:hidden">
                  <motion.button
                    type="button"
                    aria-label="Close"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    role="menu"
                    className="fixed inset-x-0 bottom-0 z-[110] rounded-t-3xl border-t border-border/70 bg-card p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-elevated"
                  >
                    <div aria-hidden className="mx-auto mb-2 mt-1 h-1 w-10 rounded-full bg-border" />
                    {items}
                    <button type="button" onClick={() => setOpen(false)} className="mt-1 w-full rounded-2xl py-3 text-center text-sm font-semibold text-muted-foreground transition hover:bg-secondary">
                      Cancel
                    </button>
                  </motion.div>
                </div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
