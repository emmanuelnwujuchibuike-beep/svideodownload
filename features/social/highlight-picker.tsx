"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PendingButton } from "@/features/frenz-ui/pending";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { HIGHLIGHT_TITLE_MAX, type Highlight } from "@/lib/social/story-highlights-shared";
import { cn } from "@/lib/utils";

/**
 * "Add to highlight" (Stories Part 5, 2026-10-27) — from the Highlight button on your own story and the Story options
 * tile. Your highlights with a tick on those already holding this story: a tap adds it, or takes it out again. "New
 * highlight" names a new one with this story in it. Every write is the server's (lib/social/story-highlights.ts); a
 * refusal says why, in its words, and nothing on screen changes.
 *
 * Drawn on the Story options sheet's surface (the light glass over the story's picture — glass only over media).
 */
export function HighlightPicker({ open, onClose, userId, storyId }: { open: boolean; onClose: () => void; userId: string; storyId: string }) {
  const [list, setList] = useState<Highlight[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setFailed(false);
    try {
      const r = await fetch(`/api/stories/highlights?user=${encodeURIComponent(userId)}&story=${encodeURIComponent(storyId)}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { highlights?: Highlight[] };
      setList(j.highlights ?? []);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    setList(null);
    setNaming(false);
    setTitle("");
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per opening, for this story
  }, [open, storyId]);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const toggle = async (h: Highlight) => {
    if (busy) return;
    setBusy(h.id);
    haptic("light");
    try {
      const r = h.containsStory
        ? await fetch(`/api/stories/highlights/${h.id}/items?story=${encodeURIComponent(storyId)}`, { method: "DELETE" })
        : await fetch(`/api/stories/highlights/${h.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storyId }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; highlightDeleted?: boolean };
      if (!r.ok) throw new Error(j.error || "Couldn't update that highlight.");
      if (h.containsStory) {
        toast(j.highlightDeleted ? `Removed — "${h.title}" was empty, so it's gone` : `Removed from ${h.title}`, "success");
        setList((l) => (l ?? []).flatMap((x) => (x.id !== h.id ? [x] : j.highlightDeleted ? [] : [{ ...x, containsStory: false, itemCount: x.itemCount - 1 }])));
      } else {
        toast(`Added to ${h.title}`, "success");
        setList((l) => (l ?? []).map((x) => (x.id === h.id ? { ...x, containsStory: true, itemCount: x.itemCount + 1 } : x)));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update that highlight.", "error");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const t = title.replace(/\s+/g, " ").trim();
    if (!t || busy) return;
    setBusy("new");
    try {
      const r = await fetch("/api/stories/highlights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t, storyIds: [storyId] }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || "Couldn't make that highlight.");
      toast(`Saved to ${t}`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't make that highlight.", "error");
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;
  return (
    <div className="frenz-ui fixed inset-0 z-[115]" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(5,4,15,0.5)] animate-in fade-in duration-200" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="highlight-picker-title"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[80vh] max-w-lg flex-col gap-3.5 rounded-t-[32px] border-t border-white/90 bg-[rgba(246,245,251,0.94)] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 text-[#12111A] shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur backdrop-saturate-[1.7] animate-in slide-in-from-bottom duration-300 motion-reduce:animate-none"
      >
        <span aria-hidden className="h-[5px] w-10 self-center rounded-full bg-[rgba(18,17,26,0.18)]" />
        <div className="flex items-center justify-between">
          <h2 id="highlight-picker-title" className="m-0 font-heading text-[19px] font-bold tracking-[-0.4px]">
            Add to highlight
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(18,17,26,0.07)] text-[#4A4760] transition active:scale-95">
            <X className="h-4 w-4" strokeWidth={2.8} aria-hidden />
          </button>
        </div>

        <div className="-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1">
          {naming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
              className="flex items-center gap-2 rounded-[20px] bg-white p-2 shadow-[0_1px_2px_rgba(30,20,80,0.06)]"
            >
              <label htmlFor="highlight-title" className="sr-only">
                Highlight name
              </label>
              <input
                id="highlight-title"
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={HIGHLIGHT_TITLE_MAX}
                placeholder="Name this highlight"
                enterKeyHint="done"
                className="h-11 min-w-0 flex-1 rounded-[14px] bg-[#F1F0F6] px-3.5 text-base outline-none placeholder:text-[#8A879C] focus:ring-2 focus:ring-[#5B3FD8]/35"
              />
              <PendingButton type="submit" pending={busy === "new"} disabled={!title.trim()} spinnerSize={16} className="h-11 shrink-0 rounded-[14px] bg-[linear-gradient(90deg,#3D5AFE,#7B3FE4)] px-4 text-[14px] font-extrabold text-white disabled:opacity-50">
                Save
              </PendingButton>
            </form>
          ) : (
            <button type="button" onClick={() => setNaming(true)} className="flex w-full items-center gap-3 rounded-[20px] bg-white px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(30,20,80,0.06)] transition active:scale-[0.99]">
              <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[#C9C5DD] text-[#5B3FD8]">
                <Plus className="h-5 w-5" strokeWidth={2.6} />
              </span>
              <span className="text-[15px] font-bold">New highlight</span>
            </button>
          )}

          {list === null && !failed ? (
            <div role="status" className="mt-2.5 flex flex-col gap-2" aria-label="Loading your highlights">
              {[0, 1].map((i) => (
                <span key={i} className="h-[66px] rounded-[20px] bg-white/70" />
              ))}
            </div>
          ) : failed ? (
            <div role="alert" className="mt-2.5 flex items-center justify-between rounded-[20px] bg-white px-3.5 py-3">
              <span className="text-[14px] text-[#5A5770]">Couldn&apos;t load your highlights.</span>
              <button type="button" onClick={() => void load()} className="h-11 px-1 text-[14px] font-bold text-[#3D2BB8]">
                Try again
              </button>
            </div>
          ) : list && list.length > 0 ? (
            <ul className="mt-2.5 overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(30,20,80,0.06)]" aria-label="Your highlights">
              {list.map((h, i) => (
                <li key={h.id} className={cn(i > 0 && "border-t border-[#F0EEF8]")}>
                  <PendingButton
                    pending={busy === h.id}
                    onClick={() => void toggle(h)}
                    aria-pressed={!!h.containsStory}
                    spinnerSize={18}
                    className="w-full px-3.5 py-2.5 text-left"
                    inner="flex w-full items-center gap-3"
                  >
                    <HighlightCover url={h.coverUrl} size={48} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-bold">{h.title}</span>
                      <span className="text-[12.5px] text-[#5A5770]">
                        {h.itemCount} {h.itemCount === 1 ? "story" : "stories"}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2", h.containsStory ? "border-transparent bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4)] text-white" : "border-[#D9D6E6]")}
                    >
                      {h.containsStory ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                    </span>
                  </PendingButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 px-1 text-[13.5px] leading-snug text-[#5A5770]">Highlights keep a story on your profile after its 24 hours. Name your first one above.</p>
          )}
        </div>
      </section>
    </div>
  );
}

/** A highlight's round cover — its picture, or the brand gradient while there is none. */
export function HighlightCover({ url, size }: { url: string | null; size: number }) {
  return (
    <span aria-hidden className="flex shrink-0 overflow-hidden rounded-full bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4,#C23FD1)]" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own media CDN, already sized; the story viewer draws stories the same way */}
      {url ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
    </span>
  );
}
