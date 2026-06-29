"use client";

import { Check, Flag, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const REASONS = ["Copyright / DMCA", "Inappropriate", "Spam", "Harassment", "Other"];

/** Report a post/comment/user. Opens a small reason menu; auth required. */
export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "comment" | "user";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const report = async (reason: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      setDone(true);
      setTimeout(() => setOpen(false), 1200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Flag className="h-4 w-4" /> Report
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-52 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated">
          {done ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-green-500">
              <Check className="h-4 w-4" /> Thanks — reported.
            </p>
          ) : (
            REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={busy}
                onClick={() => report(r)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-secondary disabled:opacity-60"
              >
                {r}
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
