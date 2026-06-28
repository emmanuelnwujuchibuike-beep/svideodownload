"use client";

import { Ban, Check, Link2, Loader2, MoreHorizontal, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Overflow menu on a profile: copy link + block/unblock. Shown to signed-in
 * viewers on profiles that aren't their own.
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
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-44 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated"
        >
          <button
            type="button"
            role="menuitem"
            onClick={copy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-secondary"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Link2 className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={toggleBlock}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 transition hover:bg-red-500/10 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : blocked ? (
              <ShieldOff className="h-4 w-4" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            {blocked ? "Unblock" : "Block"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
