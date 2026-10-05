"use client";

import { Clapperboard, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { KLING_OMNI, klingMaxReferenceImages } from "@/lib/ai/kling/features/capabilities";
import { ReferenceUploadError, uploadReference } from "@/lib/ai/video/reference-upload";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REFERENCES — a small grid on the left, more slots on request, one video
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "make the reference image slot at the left side and a
 * button to show more reference image slots if they want — all the slots
 * shouldn't show at once, only one small grid at the left should show first and
 * a button to open more slots. But the reference video slot should be one as
 * Kling AI says." The feel is CapCut's tray plus ElevenLabs' restraint: the
 * controls are small, square and quiet until something is in them.
 *
 * ── 🔴 THE CEILING MOVES, AND THAT IS THE WHOLE DESIGN PROBLEM ─────────────
 *
 * Kling, verbatim: "Up to 7 reference images (up to 4 when also using a
 * reference video)."
 *
 * So the number of slots is not a constant — attaching the video has to TAKE
 * SLOTS AWAY. Getting this wrong is not a cosmetic bug: the member composes six
 * images, adds a video, pays, and Kling refuses the request. Two rules keep that
 * impossible here:
 *
 *   · the ceiling comes from `klingMaxReferenceImages(hasVideo)` — the same
 *     function the server validates with, so the picker cannot offer a
 *     combination the pipeline will refuse;
 *   · the video slot REFUSES to open while more images are attached than it
 *     could carry, and says so, instead of silently discarding the extras. A
 *     surface that throws away a member's work to satisfy a limit is worse than
 *     one that explains the limit.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 *
 * Nothing here prices anything. Attaching a reference changes the request, the
 * request is re-quoted by the server, and the sticky bar shows what came back.
 * A surcharge computed in the browser would be the frontend deciding the price.
 */

/** How many slots are visible before the member asks for more. One tidy row of four. */
const INITIAL_SLOTS = 4;

export interface AiReferenceRailProps {
  images: string[];
  onImagesChange: (urls: string[]) => void;
  videoUrl: string | null;
  onVideoChange: (url: string | null) => void;
  /** Locked while a generation is in flight. */
  disabled?: boolean;
  className?: string;
}

export function AiReferenceRail({ images, onImagesChange, videoUrl, onVideoChange, disabled, className }: AiReferenceRailProps) {
  const maxImages = klingMaxReferenceImages(!!videoUrl);
  const [revealed, setRevealed] = useState(INITIAL_SLOTS);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyImage, setBusyImage] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoName, setVideoName] = useState<string | null>(null);

  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  /*
    When the video takes the ceiling down to 4, a grid still showing seven empty
    squares is lying about what is available. The reveal is clamped rather than
    reset, so a member who had opened all seven does not have to open them again
    after removing the video.
  */
  const visible = Math.min(Math.max(revealed, images.length), maxImages);
  const canReveal = visible < maxImages;

  useEffect(() => {
    if (problem) setProblem(null);
    // Intentionally keyed on the inputs only: a new attempt clears the last refusal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, videoUrl]);

  const addImages = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const room = maxImages - images.length;
      if (room <= 0) {
        setProblem(`You've attached the maximum of ${maxImages} reference images.`);
        return;
      }
      const chosen = Array.from(files).slice(0, room);
      if (files.length > room) setProblem(`Only ${room} more ${room === 1 ? "image fits" : "images fit"} — the rest were not added.`);

      setBusyImage(true);
      const added: string[] = [];
      try {
        for (const file of chosen) {
          const up = await uploadReference(file, "image");
          added.push(up.url);
        }
      } catch (e) {
        setProblem(e instanceof ReferenceUploadError ? e.message : "That image couldn't be added.");
      } finally {
        // Whatever succeeded is kept. Discarding four good uploads because the
        // fifth failed would make the member do all of it again.
        if (added.length) onImagesChange([...images, ...added]);
        setBusyImage(false);
        if (imageInput.current) imageInput.current.value = "";
      }
    },
    [images, maxImages, onImagesChange],
  );

  const addVideo = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      /*
        🔴 Refuse, do not truncate. Attaching this video would drop the ceiling
        to 4, and silently deleting images 5–7 to make room would destroy work
        the member did on purpose.
      */
      const ceiling = klingMaxReferenceImages(true);
      if (images.length > ceiling) {
        setProblem(`A reference video allows up to ${ceiling} reference images. Remove ${images.length - ceiling} first.`);
        if (videoInput.current) videoInput.current.value = "";
        return;
      }
      setVideoBusy(true);
      setVideoProgress(0);
      try {
        const up = await uploadReference(file, "video", { onProgress: setVideoProgress });
        onVideoChange(up.url);
        setVideoName(file.name);
      } catch (e) {
        setProblem(e instanceof ReferenceUploadError ? e.message : "That video couldn't be added.");
      } finally {
        setVideoBusy(false);
        if (videoInput.current) videoInput.current.value = "";
      }
    },
    [images.length, onVideoChange],
  );

  const removeImage = (index: number) => onImagesChange(images.filter((_, i) => i !== index));

  const slots = Array.from({ length: visible }, (_, i) => i);
  const lock = disabled || busyImage;

  return (
    <div className={cn("rounded-[1.25rem] bg-secondary/40 p-3.5 ring-1 ring-inset ring-black/[0.04] dark:bg-white/[0.035] dark:ring-white/[0.06]", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-bold tracking-[-0.01em]">
          References <span className="font-medium text-muted-foreground">· optional</span>
        </h3>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {images.length}/{maxImages}
        </span>
      </div>

      {/*
        ── STACKED, FOR A PHONE (redesign 2026-10-05) ──────────────────────
        This was the grid on the left and the explanation beside it. At
        390 px that left the text a column four words wide and wrapped the
        video button into a three-line blob (measured on a screenshot). Now:
        the image slots across the full width, one line of explanation, then
        the reference video as its own row — the same row shape as the
        workspace's settings.
      */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {slots.map((slot) => {
          const url = images[slot];
          return url ? (
            <div key={slot} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL; the optimizer cannot cache it and would re-fetch on every mint */}
              <img src={url} alt={`Reference ${slot + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(slot)}
                disabled={disabled}
                aria-label={`Remove reference ${slot + 1}`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/80"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <button
              key={slot}
              type="button"
              onClick={() => imageInput.current?.click()}
              disabled={lock}
              aria-label="Add a reference image"
              className={cn(
                "flex aspect-square items-center justify-center rounded-xl border border-dashed border-indigo-300/70 bg-indigo-50/30 text-indigo-500 transition dark:border-white/15",
                !lock && "hover:border-indigo-400 hover:bg-indigo-50/70 active:scale-[0.96]",
                lock && "opacity-50",
              )}
            >
              {busyImage ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-5 w-5" aria-hidden />}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="text-[12px] leading-snug text-muted-foreground">
          Keep a face, a product or a place consistent — up to {KLING_OMNI.images.max} images, or {KLING_OMNI.images.maxWithReferenceVideo} with a reference video.
        </p>
        {canReveal ? (
          <button
            type="button"
            onClick={() => setRevealed(maxImages)}
            disabled={lock}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11.5px] font-semibold text-foreground ring-1 ring-inset ring-black/[0.08] transition hover:bg-secondary disabled:opacity-50 dark:ring-white/10"
          >
            <Plus className="h-3 w-3" aria-hidden /> {maxImages - visible} more
          </button>
        ) : null}
      </div>

      {/* ── the one video slot, as a row ───────────────────────────────────── */}
      <div className="mt-3 flex items-center gap-2.5 rounded-2xl bg-card px-2.5 py-2 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <Clapperboard className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">{videoUrl ? (videoName ?? "Reference video") : "Reference video"}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
            {videoBusy ? `Uploading ${Math.round(videoProgress * 100)}%` : videoUrl ? "Attached — guides the motion" : "MP4 or MOV"}
          </span>
        </span>
        {videoUrl ? (
          <button
            type="button"
            onClick={() => {
              onVideoChange(null);
              setVideoName(null);
            }}
            disabled={disabled}
            aria-label="Remove the reference video"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => videoInput.current?.click()}
            disabled={disabled || videoBusy}
            className={cn(
              "inline-flex min-h-[2.25rem] shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-indigo-300/80 px-3 text-[12.5px] font-semibold text-indigo-700 transition dark:text-indigo-200",
              !(disabled || videoBusy) && "hover:bg-indigo-50/70 active:scale-[0.97]",
              (disabled || videoBusy) && "opacity-50",
            )}
          >
            {videoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
            Add video
          </button>
        )}
      </div>

      {problem ? (
        <p role="status" className="mt-2.5 text-[11.5px] font-semibold leading-snug text-rose-500">
          {problem}
        </p>
      ) : null}

      {/* The pickers. `multiple` on the images because somebody attaching four
          references has them in one place, and four separate taps is four
          chances to give up. */}
      <input
        ref={imageInput}
        type="file"
        accept={KLING_OMNI.images.mimeTypes.join(",")}
        multiple
        className="sr-only"
        onChange={(e) => void addImages(e.target.files)}
        tabIndex={-1}
      />
      <input ref={videoInput} type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={(e) => void addVideo(e.target.files)} tabIndex={-1} />
    </div>
  );
}
