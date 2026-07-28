"use client";

import { BookOpen, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { JOURNAL_CONTENT_MAX, type JournalEntry } from "@/lib/social/journal";
import { PROFILE_MOODS } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Private Journal (owner rail) — short private notes, real and persisted
 * (migration 0100). Always owner-only: this component is only ever mounted
 * inside the owner's own CreatorRail, never for a visitor, and the API route
 * behind it can only ever read/write the signed-in caller's own rows (RLS).
 */
export function PrivateJournalCard({ initialEntries }: { initialEntries: JournalEntry[] }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [mood, setMood] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const write = async () => {
    if (busy || !content.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), mood: mood || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't save your entry.");
        return;
      }
      setContent("");
      setMood("");
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-tile text-white shadow-sm">
          <BookOpen className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-tight">Private Journal</h2>
          <p className="text-xs text-muted-foreground">Only you will ever see this</p>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-border/60 bg-secondary/20 p-3.5">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={JOURNAL_CONTENT_MAX}
          rows={3}
          placeholder="What's on your mind today?"
          className="mb-2 w-full resize-none rounded-xl bg-background p-3 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
        />
        <div className="flex items-center gap-2">
          <select
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            className="h-9 flex-1 appearance-none rounded-lg bg-background px-2.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary sm:flex-none"
          >
            <option value="">No mood</option>
            {PROFILE_MOODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" onClick={write} disabled={busy || !content.trim()} className="btn-lux btn-lux-primary ml-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
        </div>
        {err ? <p className="mt-2 text-xs font-medium text-red-400">{err}</p> : null}
      </div>

      {initialEntries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          Your private entries will appear here — nobody else ever sees them.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {initialEntries.map((e) => (
            <li key={e.id} className={cn("rounded-2xl border border-border/50 bg-secondary/15 p-3.5")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{formatEntryDate(e.createdAt)}</span>
                {e.mood ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{e.mood}</span> : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{e.content}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
