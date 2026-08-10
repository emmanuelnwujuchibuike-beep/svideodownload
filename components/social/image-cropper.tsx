"use client";

import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { clampOffset, coverScale, outputSize, sourceRect } from "@/lib/media/crop";
import { cn } from "@/lib/utils";

/**
 * Avatar / cover cropper — Feature 18 (profile), 2026-08-10.
 *
 * ── The gap this fills ───────────────────────────────────────────────────────
 * Owner: "we haven't structured the avatar creation by using image."
 *
 * Setting an avatar from a photo DID exist — `ImageUpload kind="avatar"` writes
 * `profile_avatar_url` and flips `identity_mode`. What did not exist is the step
 * between choosing a file and it becoming an avatar. The uploader sent the
 * original bytes untouched, so framing was left entirely to `object-cover` at
 * whatever size the avatar happened to render: a landscape photo lost both ends,
 * a full-body shot became a torso, and — because different surfaces render the
 * avatar at different sizes — the SAME photo was cropped differently in the
 * header, the menu and a comment row. Nobody could put their own face in the
 * circle on purpose.
 *
 * ── Why crop here rather than with CSS at each call site ─────────────────────
 * A crop decided at render time is a different crop on every surface, and it
 * has to be re-decided by every future component. Baking the person's choice
 * into a square file means every surface — including ones not written yet, and
 * including places we do not control like an OG card or a push notification —
 * shows the framing they picked.
 *
 * It is also a large bandwidth win, which is why the export is capped: a 4 MB
 * 4000×3000 phone photo becomes a ~512px square JPEG, and that file is then
 * fetched by every avatar on every screen.
 *
 * ── The maths, stated once ───────────────────────────────────────────────────
 * The viewport is a square of `VIEWPORT` CSS pixels. `base` scales the image to
 * COVER that square at zoom 1, so there is never a gap; `scale = base * zoom`.
 * `offset` moves the image's centre relative to the viewport's, in CSS pixels,
 * and is clamped so the square is always fully covered — you cannot drag empty
 * space into frame, which removes a whole class of "why is my avatar
 * transparent" bug rather than validating for it later.
 *
 * Export maps the viewport back into source pixels and draws that rect to a
 * canvas, so the output is the exact region under the mask.
 */

/** On-screen size of the crop square. */
const VIEWPORT = 264;
/** Exported edge length. Retina-sharp at every avatar size we render. */
const OUTPUT = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface Offset {
  x: number;
  y: number;
}

export function ImageCropper({
  file,
  /** 1 for an avatar; a cover uses a wider ratio. */
  aspect = 1,
  round = true,
  onCancel,
  onDone,
  busy = false,
}: {
  file: File;
  aspect?: number;
  round?: boolean;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  busy?: boolean;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ id: number; startX: number; startY: number; from: Offset } | null>(null);
  const frameW = VIEWPORT;
  const frameH = Math.round(VIEWPORT / aspect);

  /* Decode from an object URL and release it — a leaked blob URL keeps the
     whole original file in memory for the life of the tab. */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => setImg(image);
    image.onerror = () => setError("That image could not be opened. Try another one.");
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* The geometry lives in lib/media/crop.ts and is unit-tested — see the note
     there for why it is not inline. */
  const natural = { width: img?.naturalWidth ?? 0, height: img?.naturalHeight ?? 0 };
  const frame = { width: frameW, height: frameH };
  const base = img ? coverScale(natural, frame) : 1;
  const scale = base * zoom;

  const clamp = useCallback(
    (next: Offset, s: number): Offset => {
      if (!img) return { x: 0, y: 0 };
      return clampOffset(next, { width: img.naturalWidth, height: img.naturalHeight }, { width: frameW, height: frameH }, s);
    },
    [img, frameW, frameH],
  );

  // Re-clamp when zooming out, or the image would leave a gap it cannot recover
  // from — the offset that was legal at 3× is not legal at 1×.
  useEffect(() => {
    setOffset((o) => clamp(o, base * zoom));
  }, [zoom, base, clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, from: offset };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset(clamp({ x: d.from.x + (e.clientX - d.startX), y: d.from.y + (e.clientY - d.startY) }, scale));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  /* Escape cancels — a modal that traps you is worse than no modal. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const apply = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    const out = outputSize(frame, OUTPUT);
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setError("Your browser could not process the image.");

    const { sx, sy, sw, sh } = sourceRect(natural, frame, scale, offset);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);

    canvas.toBlob(
      (blob) => (blob ? onDone(blob) : setError("Could not save that crop. Try again.")),
      "image/jpeg",
      0.9,
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Position your photo"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-3xl border border-border/70 bg-card p-4 shadow-elevated">
        <h2 className="text-base font-bold tracking-tight">Position your photo</h2>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          Drag to move, and use the slider to zoom. Everything inside the frame is what people will see.
        </p>

        <div className="mt-3 flex justify-center">
          <div
            style={{ width: frameW, height: frameH }}
            className={cn(
              "relative touch-none select-none overflow-hidden bg-secondary",
              round ? "rounded-full" : "rounded-2xl",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {img ? (
              /* eslint-disable-next-line @next/next/no-img-element -- a local object URL being positioned by transform; next/image cannot express this and would re-fetch it */
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{
                  width: img.naturalWidth * scale,
                  height: img.naturalHeight * scale,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                }}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </span>
            )}
            {/* A ring, not a dimming overlay: the frame IS the crop, so there is
                no "outside" to show. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/70",
                round ? "rounded-full" : "rounded-2xl",
              )}
            />
          </div>
        </div>

        {/* A real range input: operable by keyboard and by switch control, and
            announced with a value — which a pinch gesture never is. */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.2).toFixed(2)))}
            aria-label="Zoom out"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.2).toFixed(2)))}
            aria-label="Zoom in"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
            aria-label="Reset position"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-500">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!img || busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Saving…" : "Use photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
