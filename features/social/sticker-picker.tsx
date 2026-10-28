"use client";

import { Bookmark, BookmarkCheck, Plus, Star, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { STICKER_GROUPS, STICKERS, type Sticker } from "@/lib/social/stickers";
import { videoStickerUuid } from "@/lib/social/video-stickers";
import { cn } from "@/lib/utils";

import { VideoSticker } from "./video-sticker";

/*
  The comment sticker panel (owner, 2026-10-28: "the modal shouldn't go above the comment sheet, it should only use the
  keyboard and comment sheet space for the sticker and can scroll Y axis like tiktok").

  It is NOT a popover: the composer renders it inline, under its own row, in the space the keyboard takes (the
  composer drops the keyboard when it opens), at most ~45 % of the screen, scrolling vertically. Tabs: ★ Library
  (Make a sticker, then your video stickers and saved ones), then the emoji groups.

  Video stickers (0303): made here (VideoStickerMaker, loaded only when "Make" is tapped), kept in the member's library
  (/api/stickers, the same table as saved emoji), and saved from anyone's comment with the bookmark there.
*/

const VideoStickerMaker = dynamic(() => import("./video-sticker-maker").then((m) => m.VideoStickerMaker), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-xs text-muted-foreground">Loading…</p>,
});

/** What the composer attaches: an emoji sticker, or a video sticker with its clip. */
export interface PickedSticker {
  id: string;
  label: string;
  glyph?: string;
  video?: { videoUrl: string; posterUrl: string };
}

type Library = { saved: string[]; video: { id: string; videoUrl: string; posterUrl: string }[] };

// the library is read once per visit and kept: opening the panel again is instant
let libraryCache: Library | null = null;
const listeners = new Set<(l: Library) => void>();
function setLibrary(next: Library) {
  libraryCache = next;
  listeners.forEach((f) => f(next));
}
export function loadStickerLibrary(force = false): Promise<Library> {
  if (libraryCache && !force) return Promise.resolve(libraryCache);
  return fetch("/api/stickers", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { saved: [], video: [] }))
    .then((j: Partial<Library>) => {
      const lib = { saved: j.saved ?? [], video: j.video ?? [] };
      setLibrary(lib);
      return lib;
    })
    .catch(() => libraryCache ?? { saved: [], video: [] });
}

/** Save (or remove) a sticker in the member's library — emoji or video, theirs or someone else's. */
export async function toggleLibrarySticker(sticker: { id: string; videoUrl?: string; posterUrl?: string }, save: boolean): Promise<boolean> {
  const before = libraryCache ?? (await loadStickerLibrary());
  const video = videoStickerUuid(sticker.id);
  setLibrary({
    saved: save ? [sticker.id, ...before.saved.filter((x) => x !== sticker.id)] : before.saved.filter((x) => x !== sticker.id),
    video: video
      ? save && sticker.videoUrl && sticker.posterUrl
        ? [{ id: sticker.id, videoUrl: sticker.videoUrl, posterUrl: sticker.posterUrl }, ...before.video.filter((v) => v.id !== sticker.id)]
        : before.video.filter((v) => v.id !== sticker.id)
      : before.video,
  });
  try {
    const r = save
      ? await fetch("/api/stickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sticker: sticker.id }) })
      : await fetch(`/api/stickers?sticker=${encodeURIComponent(sticker.id)}`, { method: "DELETE" });
    if (!r.ok) throw new Error();
    return true;
  } catch {
    setLibrary(before);
    return false;
  }
}

export function useStickerLibrary(): Library | null {
  const [lib, setLib] = useState<Library | null>(libraryCache);
  useEffect(() => {
    listeners.add(setLib);
    void loadStickerLibrary();
    return () => void listeners.delete(setLib);
  }, []);
  return lib;
}

export function StickerPicker({ onPick, onClose }: { onPick: (sticker: PickedSticker) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"library" | Sticker["group"]>("library");
  const [making, setMaking] = useState(false);
  const lib = useStickerLibrary();
  const savedEmoji = STICKERS.filter((s) => lib?.saved.includes(s.id));

  return (
    <div className="flex max-h-[45dvh] min-h-[16rem] flex-col overflow-hidden rounded-2xl bg-secondary/40">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabChip active={tab === "library"} onClick={() => { setTab("library"); setMaking(false); }} label="Your stickers">
          <Star className="h-4 w-4" aria-hidden />
        </TabChip>
        {STICKER_GROUPS.map((g) => (
          <TabChip key={g.key} active={tab === g.key} onClick={() => { setTab(g.key); setMaking(false); }} label={g.label}>
            <span className="text-lg leading-none">{STICKERS.find((s) => s.group === g.key)?.glyph}</span>
          </TabChip>
        ))}
        <button type="button" onClick={onClose} aria-label="Close stickers" className="ml-auto shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* the one scroller: vertical, inside the panel — the comment sheet itself never moves */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {making ? (
          <VideoStickerMaker
            onBack={() => setMaking(false)}
            onMade={(s) => {
              setMaking(false);
              setLibrary({ saved: [s.id, ...(libraryCache?.saved ?? [])], video: [s, ...(libraryCache?.video ?? [])] });
              onPick({ id: s.id, label: "Sticker", video: { videoUrl: s.videoUrl, posterUrl: s.posterUrl } });
            }}
          />
        ) : tab === "library" ? (
          <div className="p-2">
            <p className="px-1 pb-2 text-xs font-semibold text-muted-foreground">Your stickers</p>
            <div className="grid grid-cols-4 gap-2">
              <button type="button" onClick={() => setMaking(true)} aria-label="Make a sticker from a video" className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl bg-card text-muted-foreground transition active:scale-95">
                <Plus className="h-7 w-7" aria-hidden />
                <span className="text-[11px] font-semibold">Make</span>
              </button>
              {(lib?.video ?? []).map((v) => (
                <div key={v.id} className="group relative">
                  <button type="button" onClick={() => onPick({ id: v.id, label: "Sticker", video: { videoUrl: v.videoUrl, posterUrl: v.posterUrl } })} aria-label="Send this sticker" className="block w-full transition active:scale-95">
                    <VideoSticker videoUrl={v.videoUrl} posterUrl={v.posterUrl} size={200} className="aspect-square h-auto w-full" />
                  </button>
                  <SaveToggle saved onToggle={() => void toggleLibrarySticker(v, false)} />
                </div>
              ))}
              {savedEmoji.map((s) => (
                <EmojiTile key={s.id} s={s} saved onPick={onPick} />
              ))}
            </div>
            {lib && !lib.video.length && !savedEmoji.length ? (
              <p className="px-4 pb-4 pt-3 text-center text-xs text-muted-foreground">Make a sticker from 3 seconds of any video, or save one from the comments.</p>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-1 p-2 sm:grid-cols-6">
            {STICKERS.filter((s) => s.group === tab).map((s) => (
              <EmojiTile key={s.id} s={s} saved={!!lib?.saved.includes(s.id)} onPick={onPick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmojiTile({ s, saved, onPick }: { s: Sticker; saved: boolean; onPick: (p: PickedSticker) => void }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onPick({ id: s.id, label: s.label, glyph: s.glyph })}
        aria-label={s.label}
        className="flex aspect-square w-full items-center justify-center rounded-xl text-3xl transition hover:bg-secondary active:scale-90"
      >
        {s.glyph}
      </button>
      <SaveToggle saved={saved} onToggle={() => void toggleLibrarySticker({ id: s.id }, !saved)} />
    </div>
  );
}

function SaveToggle({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={saved ? "Remove from your stickers" : "Save to your stickers"}
      className={cn("absolute right-0.5 top-0.5 rounded-full bg-card/80 p-1 transition", saved ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100")}
    >
      {saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
    </button>
  );
}

function TabChip({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn("flex h-10 w-11 shrink-0 items-center justify-center rounded-xl transition", active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary")}
    >
      {children}
    </button>
  );
}
