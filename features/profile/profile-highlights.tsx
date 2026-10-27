"use client";

import { Check, Plus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PendingButton } from "@/features/frenz-ui/pending";
import { HighlightCover } from "@/features/social/highlight-picker";
import { toast } from "@/features/ui/toast";
import { HIGHLIGHT_TITLE_MAX, type Highlight } from "@/lib/social/story-highlights-shared";
import { cn } from "@/lib/utils";

// the full-screen viewer loads on the first tap of a circle, never with the profile
const HighlightViewer = dynamic(() => import("@/features/social/highlight-viewer").then((m) => m.HighlightViewer), { ssr: false });

export type OwnStory = { id: string; mediaUrl: string; mediaKind: "image" | "video"; thumbnailUrl: string | null };

/**
 * Story highlights on a profile (Stories Part 5, 2026-10-27): a row of round covers with their names; a tap plays the
 * highlight. The owner also gets "New" — while they have a story up — to make one from their current stories. Shown
 * only when there is something to show (a visitor with no highlights to see gets nothing, not an empty row).
 */
export function ProfileHighlights({ initial, isOwner, ownStories }: { initial: Highlight[]; isOwner: boolean; ownStories: OwnStory[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState<Highlight | null>(null);
  const [creating, setCreating] = useState(false);
  const canCreate = isOwner && ownStories.length > 0;
  if (!list.length && !canCreate) return null;

  return (
    <section aria-label="Story highlights" className="mt-5">
      <ul className="srch-rail -mx-4 scroll-px-4 gap-3.5 px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6">
        {canCreate ? (
          <li className="w-[70px] shrink-0">
            <button type="button" onClick={() => setCreating(true)} className="flex w-full flex-col items-center gap-1.5 transition-transform active:scale-[0.97]">
              <span className="flex h-[66px] w-[66px] items-center justify-center rounded-full border-2 border-dashed border-frenz-line text-frenz-violet">
                <Plus className="h-6 w-6" strokeWidth={2.4} aria-hidden />
              </span>
              <span className="text-[12.5px] font-semibold">New</span>
            </button>
          </li>
        ) : null}
        {list.map((h) => (
          <li key={h.id} className="w-[70px] shrink-0">
            <button type="button" onClick={() => setOpen(h)} aria-label={`${h.title}, ${h.itemCount} ${h.itemCount === 1 ? "story" : "stories"}`} className="flex w-full flex-col items-center gap-1.5 transition-transform active:scale-[0.97]">
              <span className="flex h-[66px] w-[66px] items-center justify-center rounded-full border border-frenz-line bg-frenz-card p-[3px]">
                <HighlightCover url={h.coverUrl} size={58} />
              </span>
              <span className="w-full truncate text-center text-[12.5px] font-semibold">{h.title}</span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <HighlightViewer
          highlightId={open.id}
          summary={open}
          isOwner={isOwner}
          onClose={() => setOpen(null)}
          onChanged={(next) => setList((l) => (next ? l.map((x) => (x.id === next.id ? next : x)) : l.filter((x) => x.id !== open.id)))}
        />
      ) : null}
      {creating ? (
        <NewHighlightSheet
          stories={ownStories}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            // the new circle comes from the server's own answer
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function NewHighlightSheet({ stories, onClose, onCreated }: { stories: OwnStory[]; onClose: () => void; onCreated: () => void }) {
  const [picked, setPicked] = useState<string[]>(() => stories.map((s) => s.id));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const t = title.replace(/\s+/g, " ").trim();
    if (!t || !picked.length || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/stories/highlights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t, storyIds: picked }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || "Couldn't make that highlight.");
      toast(`Saved to ${t}`, "success");
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't make that highlight.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="frenz-ui fixed inset-0 z-[105]" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/45 animate-in fade-in duration-200" />
      <section role="dialog" aria-modal="true" aria-labelledby="new-highlight-title" className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85vh] max-w-lg flex-col gap-3.5 rounded-t-[28px] bg-frenz-card px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 animate-in slide-in-from-bottom duration-300 motion-reduce:animate-none">
        <div className="flex items-center justify-between">
          <h2 id="new-highlight-title" className="font-heading text-[19px] font-bold tracking-[-0.4px]">
            New highlight
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <label htmlFor="new-highlight-name" className="sr-only">
          Highlight name
        </label>
        <input
          id="new-highlight-name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={HIGHLIGHT_TITLE_MAX}
          placeholder="Name this highlight"
          className="h-[52px] rounded-[26px] bg-frenz-fill px-5 text-base outline-none placeholder:text-frenz-muted focus:ring-2 focus:ring-frenz-violet/35"
        />
        <p className="text-[13px] text-frenz-muted">Your stories up now — pick the ones to keep.</p>
        <ul className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto overscroll-contain">
          {stories.map((s) => {
            const on = picked.includes(s.id);
            const pic = s.mediaKind === "video" ? s.thumbnailUrl : s.mediaUrl;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={on ? "Selected story" : "Story"}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                  className={cn("relative block aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-frenz-fill ring-2 transition", on ? "ring-frenz-violet" : "ring-transparent opacity-70")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own media CDN */}
                  {pic ? <img src={pic} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
                  <span aria-hidden className={cn("absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white", on ? "bg-frenz-gradient-x" : "bg-black/30")}>
                    {on ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <PendingButton pending={busy} disabled={!title.trim() || !picked.length} onClick={() => void create()} className="h-[52px] rounded-[26px] bg-frenz-gradient-x font-heading text-[16px] font-bold text-white disabled:opacity-50">
          Save highlight
        </PendingButton>
      </section>
    </div>
  );
}
