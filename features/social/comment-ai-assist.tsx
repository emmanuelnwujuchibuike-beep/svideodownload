"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useState } from "react";

/**
 * AI writing assist flyout (Part 5 tranche 3) — Polish (grammar/tone) or
 * Translate, calling /api/comments/assist (the proven direct-Anthropic-fetch
 * pattern, gated behind ANTHROPIC_API_KEY). Code-split (dynamic import in
 * comments.tsx) the same way ReportSheet/PinLabelPicker are — most comments
 * are never AI-assisted, so this stays out of the initial comment bundle.
 * Always shows a preview with an explicit "Use this" — never silently
 * rewrites the author's draft.
 */

const LANGUAGES = ["Spanish", "French", "German", "Portuguese", "Japanese", "Korean", "Hindi", "Arabic"];

export function CommentAiAssist({ text, onApply, onClose }: { text: string; onApply: (t: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); // which action is in flight
  const [err, setErr] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const run = async (mode: "polish" | "translate", targetLanguage?: string) => {
    if (!text.trim() || busy) return;
    setBusy(targetLanguage ?? mode);
    setErr(null);
    try {
      const res = await fetch("/api/comments/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode, targetLanguage }),
      });
      const j = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        setErr(j.error ?? "Couldn't get a suggestion.");
        return;
      }
      setSuggestion(j.text ?? null);
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-2 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-soft backdrop-blur-xl">
      {suggestion ? (
        <>
          <p className="text-sm leading-relaxed">{suggestion}</p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                onApply(suggestion);
                onClose();
              }}
              className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-1 text-xs font-semibold text-white"
            >
              Use this
            </button>
            <button type="button" onClick={() => setSuggestion(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Wand2 className="h-3.5 w-3.5" /> AI writing assist
            </span>
            <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
          <button
            type="button"
            onClick={() => run("polish")}
            disabled={!!busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
          >
            {busy === "polish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Polish
          </button>
          <p className="mb-1 mt-2.5 text-[11px] font-semibold text-muted-foreground">Translate to…</p>
          <div className="flex flex-wrap gap-1">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => run("translate", l)}
                disabled={!!busy}
                className="rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-60"
              >
                {busy === l ? <Loader2 className="h-3 w-3 animate-spin" /> : l}
              </button>
            ))}
          </div>
          {err ? <p className="mt-2 text-xs text-red-400">{err}</p> : null}
        </>
      )}
    </div>
  );
}
