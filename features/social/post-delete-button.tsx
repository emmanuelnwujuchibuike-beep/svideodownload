"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Owner-only delete for a published post/download. Two-step arm-to-confirm
 * (no browser dialogs): first tap arms "Delete post?" for 3s, second tap
 * deletes and returns to the given destination. The API is owner-scoped
 * (DELETE /api/posts/:id filters on publisher_id), so this can't touch
 * anyone else's content.
 */
export function PostDeleteButton({ postId, redirectTo = "/home" }: { postId: string; redirectTo?: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = async () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (res.ok) {
        router.push(redirectTo);
        router.refresh();
        return;
      }
    } catch {
      /* fall through to reset */
    }
    setBusy(false);
    setArmed(false);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={armed ? "Confirm delete post" : "Delete post"}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:opacity-60",
        armed
          ? "border border-rose-500/50 bg-rose-500/15 text-rose-500 shadow-rose-500/20"
          : "border border-border/70 bg-card/70 text-muted-foreground hover:border-rose-500/40 hover:text-rose-500 hover:shadow-md",
      )}
    >
      {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Trash2 className="h-[18px] w-[18px]" />}
      {armed ? "Delete post?" : "Delete"}
    </button>
  );
}
