"use client";

import { Camera, Images, Loader2, Send, Sparkles, Wand2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  STORY_RULES,
  publishComposition,
  useCaptionDraft,
  useComposerMedia,
  useComposerScrollLock,
} from "@/features/create/composer-core";
import { revalidate } from "@/features/data";
// The one shared fetcher for the `stories` key — it also refreshes the on-disk
// copy, so posting a story updates the rings on Home AND the inbox AND the next
// cold start, from a single call.
import { fetchStoryGroups } from "@/lib/social/story-cache";
import { PhotoEditor } from "@/features/create/photo-editor";
import { openStudio } from "@/features/create/studio/studio-store";
import { haptic } from "@/lib/motion/haptics";

/**
 * /create/story — the STORY surface.
 *
 * Instagram-led: black, single-media, a 9:16 stage and IG's signature
 * "Your story" send chip in the bottom-right corner rather than a full-width
 * button. The Facebook half of the blend is the explicit labelled entry tiles
 * (Gallery / Camera / Blocks) instead of IG's swipe-up tray, and the plain
 * "disappears in 24 hours" copy.
 *
 * Single-media by definition — a story is one media, so this surface never
 * grows an album rail the way /create/post does.
 */
export function StoryComposer({ avatarUrl }: { avatarUrl: string | null }) {
  const router = useRouter();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useComposerScrollLock();
  const media = useComposerMedia(STORY_RULES);
  const { items, active, err } = media;
  const { caption, setCaption, clearDraft } = useCaptionDraft("story");

  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState(false);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    media.accept(e.target.files);
    e.target.value = "";
  };

  const publish = async () => {
    if (!active || busy) return;
    setBusy(true);
    media.setErr(null);
    haptic("selection");
    try {
      await publishComposition({ items, caption, destination: "story", onProgress: setBusyText });
      clearDraft();
      setSent(true);
      // Refresh the STORY RINGS, not the route (owner, 2026-07-16: the share
      // button "is glitching ... and is stuck on the share story load button").
      // This used to call `router.refresh()` and then immediately `router.push`
      // — re-rendering the very page we're leaving, which put the composer
      // through a re-render mid-transition while it was still showing its
      // busy state. Revalidating the shared "stories" key instead updates every
      // stories row (home + inbox) with no RSC churn on a dying route.
      void revalidate("stories", fetchStoryGroups).catch(() => {});
      // A story has no permalink to share or copy — it lives in the ring for
      // 24h — so this surface confirms and leaves rather than showing the
      // post/reel "Share link" success screen.
      setTimeout(() => router.push("/home"), 900);
    } catch (e) {
      media.setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      // ALWAYS clear the busy state. This was the real "stuck on the share
      // story load button" bug: the success path never reset `busy`/`busyText`
      // (there was no `finally`), so if the navigation was slow or never
      // happened the button sat on "Uploading…" forever, disabled, with no way
      // back. `sent` still keeps it disabled and reading "Shared" afterwards.
      setBusy(false);
      setBusyText(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <input ref={galleryRef} type="file" accept="image/*,video/*" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />
      <input ref={cameraRef} type="file" accept="image/*,video/*" capture="user" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />

      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(var(--frenz-safe-top),0.5rem)] pb-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-[17px] font-bold tracking-tight">Add to story</h1>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/70">24h</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-3">
        {editing && active && active.kind === "image" ? (
          <div className="max-h-full w-full max-w-md overflow-y-auto">
            <PhotoEditor
              src={active.preview}
              original={active.original}
              initial={active.edit}
              onCancel={() => setEditing(false)}
              onApply={({ blob, edit }) => {
                media.applyEdit(active.id, blob, edit);
                setEditing(false);
              }}
            />
          </div>
        ) : active ? (
          <div className="relative flex h-full w-full max-w-[min(100%,calc((100vh-13rem)*9/16))] items-center justify-center overflow-hidden rounded-2xl bg-neutral-950 ring-1 ring-white/10">
            {active.kind === "video" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video key={active.id} src={active.display} className="h-full w-full object-contain" autoPlay muted loop playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={active.id} src={active.display} alt="" className="h-full w-full object-contain" />
            )}

            <div className="absolute right-2.5 top-2.5 flex gap-1.5">
              {active.kind === "image" ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/80"
                >
                  {active.display !== active.preview ? "Edit again" : "Edit"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => media.remove(active.id)}
                aria-label="Remove"
                className="rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/80"
              >
                Replace
              </button>
            </div>

            {caption.trim() ? (
              <p className="pointer-events-none absolute inset-x-4 bottom-4 text-center text-sm font-medium drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
                {caption}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center">
            {/* Neutral, matching /create/reel's hero — a blue→violet block
                behind a glyph is exactly the treatment removed site-wide on
                2026-07-16. */}
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
              <Sparkles className="h-9 w-9 text-white" />
            </span>
            <p className="mt-4 text-lg font-bold">Share a moment</p>
            <p className="mt-1 text-center text-sm text-white/60">One photo or video. Disappears in 24 hours.</p>

            <div className="mt-6 grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/10 py-5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/15"
              >
                <Camera className="h-6 w-6" /> Camera
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/10 py-5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/15"
              >
                <Images className="h-6 w-6" /> Gallery
              </button>
            </div>

            {/* The block-based Story Studio — this is a STORY tool, so it lives
                on the story surface now instead of the old shared modal. */}
            <button
              type="button"
              onClick={() => {
                openStudio();
                router.back();
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <Wand2 className="h-4 w-4" /> Write a story — blocks, text &amp; media
            </button>

            {err ? <p className="mt-4 text-center text-sm text-rose-400">{err}</p> : null}
          </div>
        )}
      </div>

      {/* Caption + IG's bottom-right "Your story" send chip */}
      {active && !editing ? (
        <div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={300}
            placeholder="Add a caption…"
            className="h-11 w-full rounded-full bg-white/10 px-4 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-2 focus:ring-white/30"
          />

          {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}

          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={publish}
              disabled={busy || sent}
              className="inline-flex items-center gap-2 rounded-full bg-white py-2 pl-2 pr-4 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-violet-600">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </span>
              {sent ? "Shared" : busy ? (busyText ?? "Sharing…") : "Your story"}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? null : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
