"use client";

import { Clapperboard, ChevronLeft, Images, Loader2, Music2, RotateCcw, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  REEL_RULES,
  publishComposition,
  useCaptionDraft,
  useComposerMedia,
  useComposerScrollLock,
} from "@/features/create/composer-core";
import { CreateDone } from "@/features/create/surfaces/post-composer";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * /create/reel — the REEL surface.
 *
 * Instagram-led: a black, media-first, full-bleed 9:16 stage with a light
 * chrome-over-video header and a single "Share" commit — nothing like the
 * Post surface's light, text-first Facebook sheet. The Facebook half of the
 * blend shows up in the explicit labelled controls (a named header, a real
 * captioned field with a counter, plainly-worded actions) rather than IG's
 * icon-only minimalism.
 *
 * Video-only and single-item by product rule (REEL_RULES): the feed/reels
 * split means any album — and anything that isn't a video — publishes to the
 * FEED, never Reels. Enforcing that at pick time is why this surface refuses
 * a photo outright instead of accepting it and silently publishing the user's
 * "Reel" as a feed post.
 *
 * The video is `object-contain` and never cropped — the same never-crop rule
 * the Reels player itself follows.
 */
export function ReelComposer() {
  const router = useRouter();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useComposerScrollLock();
  const media = useComposerMedia(REEL_RULES);
  const { items, active, err } = media;
  const { caption, setCaption, clearDraft } = useCaptionDraft("reel");

  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

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
      const res = await publishComposition({ items, caption, destination: "reel", onProgress: setBusyText });
      clearDraft();
      setDoneUrl(res.link);
      router.refresh();
    } catch (e) {
      media.setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
      setBusyText(null);
    }
  };

  if (doneUrl) {
    return (
      <CreateDone
        dark
        title="Your Reel is live"
        subtitle="It's live in Reels and on your profile."
        onShare={async () => {
          try {
            if (navigator.share) await navigator.share({ title: "Check out my reel on Frenz", url: doneUrl });
            else await navigator.clipboard.writeText(doneUrl);
          } catch {
            /* cancelled */
          }
        }}
        onCopy={() => navigator.clipboard?.writeText(doneUrl).catch(() => {})}
        onDone={() => router.push("/reels")}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <input ref={galleryRef} type="file" accept="video/*" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />
      <input ref={cameraRef} type="file" accept="video/*" capture="user" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />

      {/* Header — chrome over the stage */}
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-[17px] font-bold tracking-tight">New reel</h1>
        {active ? (
          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className="inline-flex h-9 min-w-[84px] items-center justify-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share"}
          </button>
        ) : null}
      </header>

      {/* Stage */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-3">
        {active ? (
          <div className="relative flex h-full w-full max-w-[min(100%,calc((100vh-13rem)*9/16))] items-center justify-center overflow-hidden rounded-2xl bg-neutral-950 ring-1 ring-white/10">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video key={active.id} src={active.display} className="h-full w-full object-contain" autoPlay muted loop playsInline controls />
            <button
              type="button"
              onClick={() => media.remove(active.id)}
              className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/80"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Replace
            </button>
          </div>
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
              <Clapperboard className="h-9 w-9 text-white" />
            </span>
            <p className="mt-4 text-lg font-bold">Make a reel</p>
            <p className="mt-1 text-center text-sm text-white/60">A single full-screen video. Photos and albums go to the feed.</p>

            <div className="mt-6 grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/10 py-5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/15"
              >
                <Video className="h-6 w-6" /> Record
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/10 py-5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/15"
              >
                <Images className="h-6 w-6" /> Gallery
              </button>
            </div>
            <p className="mt-4 text-center text-[11px] text-white/40">Videos up to 100 MB</p>
          </div>
        )}
      </div>

      {/* Caption + commit */}
      {active ? (
        <div className="shrink-0 border-t border-white/10 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <div className="relative">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Write a caption…"
              className="w-full resize-none rounded-2xl bg-white/10 px-4 py-3 pr-14 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-2 focus:ring-white/30"
            />
            <span className="pointer-events-none absolute bottom-2.5 right-3 text-[10px] tabular-nums text-white/40">{caption.length}/300</span>
          </div>

          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/40">
            <Music2 className="h-3 w-3" /> Cover is taken from the first frame
          </p>

          {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}
          {busyText ? <p className="mt-2 text-sm text-white/70">{busyText}</p> : null}

          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className={cn(
              "bg-brand mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold text-white transition hover:opacity-95 disabled:opacity-50",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {busy ? (busyText ?? "Sharing…") : "Share Reel"}
          </button>
        </div>
      ) : err ? (
        <p className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] text-center text-sm text-rose-400">{err}</p>
      ) : null}
    </div>
  );
}
