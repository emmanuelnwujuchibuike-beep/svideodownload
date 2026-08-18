"use client";

import { AlertTriangle, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * "Summarize thread" (Part 5 tranche 4) — reuses /api/comments/assist's
 * "summarize" mode. Code-split (dynamic import in comments.tsx): most
 * threads are short enough nobody reaches for this. Fires once on mount
 * (the caller only mounts this when the button is tapped) — never runs
 * automatically for every viewer of a thread.
 */
export function CommentThreadSummary({ text, onClose }: { text: string; onClose: () => void }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/comments/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode: "summarize" }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) setErr(j.error ?? "Couldn't summarize this thread.");
        else setSummary(j.text ?? null);
      })
      .catch(() => {
        if (!cancelled) setErr("Network error.");
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <div className="mb-3 rounded-2xl border border-border/60 bg-card/80 p-3.5 shadow-soft backdrop-blur-xl">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Thread summary
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {err ? (
        <p className="flex items-center gap-1.5 text-sm text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {err}
        </p>
      ) : summary ? (
        <p className="text-sm leading-relaxed">{summary}</p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the thread…
        </p>
      )}
    </div>
  );
}
