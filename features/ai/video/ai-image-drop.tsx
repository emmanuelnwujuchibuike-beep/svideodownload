"use client";

import { Loader2, RefreshCw, X, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE UPLOAD SURFACE — drag on desktop, tap on a phone (Part 6 §15)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Include: drag/drop on desktop, tap-to-upload on mobile, file type
 * information, size information, preview, remove/replace, upload progress
 * where applicable, validation errors, supported format hints. Do not
 * overwhelm the user with technical details."
 *
 * So the resting state says two short things — what to do, and what is
 * accepted — and everything else (the file's name, its size) appears only once
 * there IS a file to describe.
 *
 * ── 🔴 THE LIMITS ARE THE VENDOR'S, NOT INVENTED (§47, §54) ────────────────
 *
 * jpg/png and 10 MB are Kling's own documented image limits, passed in from the
 * verified capability table rather than retyped here. They are shown BEFORE the
 * member picks a file, because §47 says a limitation belongs at the point it
 * matters — not in a paragraph after a rejection.
 *
 * ── 🔴 WHY THE PREVIEW IS AN OBJECT URL ───────────────────────────────────
 *
 * The file is previewed locally the instant it is chosen, before any network
 * call, so the surface responds in the same frame as the drop. The URL is
 * revoked when it is replaced or cleared; leaking them is how a long editing
 * session ends up holding every image the member tried.
 */

export interface AiImageDropProps {
  /** The uploaded, publicly fetchable URL — null until an upload finishes. */
  value: string | null;
  onChange: (url: string | null) => void;
  /** Does the actual upload and resolves to a URL Kling can fetch. */
  upload: (file: File) => Promise<string>;
  label: string;
  hint?: string;
  accept?: readonly string[];
  maxBytes: number;
  /** A second, optional slot reads less prominently than the required one. */
  optional?: boolean;
  /** Step 19: the large first tile ("Choose a photo · From Photos, Files or your camera") with the on-device note under it. */
  large?: boolean;
  /** A line under the tile — the on-device privacy note. */
  note?: string;
  className?: string;
}

const EXT = (mime: string) => mime.replace("image/", "").toUpperCase();

/*
  Redesign page 4 (Brief B §8–§10, §27, 2026-10-05):

  · empty: a subtle dashed, lightly tinted surface — a small sparkle tile,
    "Choose a photo", "or drag one here", the formats — no illustration;
  · filled: the photo itself, with Replace and Remove on it;
  · 🔴 a STALE upload can no longer win. Each pick takes a sequence number;
    an upload that finishes after the member replaced or removed the photo is
    ignored instead of putting the old picture back (it used to call
    `onChange` whenever it landed);
  · 🔴 the object URL is revoked on unmount too, not only on replace/clear —
    leaving the page with a photo picked used to leak it.
*/
export function AiImageDrop({ value, onChange, upload, label, hint, accept = ["image/jpeg", "image/png"], maxBytes, optional, large, note, className }: AiImageDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [meta, setMeta] = useState<{ name: string; size: number } | null>(null);
  const seq = useRef(0);
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const clear = useCallback(() => {
    seq.current += 1; // any upload still in flight is now stale
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    setMeta(null);
    setProblem(null);
    setBusy(false);
    onChange(null);
  }, [onChange]);

  const take = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setProblem(null);
      if (!accept.includes(file.type)) {
        setProblem(`That file type isn't supported. Use ${accept.map(EXT).join(" or ")}.`);
        return;
      }
      if (file.size > maxBytes) {
        setProblem(`That image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
        return;
      }
      const mine = ++seq.current;
      const local = URL.createObjectURL(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return local;
      });
      setMeta({ name: file.name, size: file.size });
      setBusy(true);
      onChange(null); // the previous photo's URL must not be generated with while this one uploads
      try {
        const url = await upload(file);
        if (mine === seq.current) onChange(url);
      } catch {
        if (mine === seq.current) {
          setProblem("That image couldn't be uploaded. Try again.");
          onChange(null);
        }
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [accept, maxBytes, onChange, upload],
  );

  const filled = !!preview || !!value;
  const formats = `${accept.map(EXT).join(" · ")} · up to ${Math.round(maxBytes / (1024 * 1024))} MB`;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("font-bold text-frenz-ink", large ? "sr-only" : "text-[15px]")}>
          {label}
          {optional ? <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">Optional</span> : null}
        </span>
        {filled || large ? null : <span className="text-[11.5px] text-frenz-muted">{formats}</span>}
      </div>
      {hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "relative overflow-hidden rounded-[22px] transition",
          large ? "mt-0" : "mt-3",
          // the photo on the light fill, never a dark stage (backgrounds stay white — owner, 2026-10-19)
          filled ? "border border-frenz-line bg-frenz-fill" : "border-[1.5px] border-dashed",
          !filled && (dragging ? "border-frenz-violet bg-frenz-violet/[0.06]" : "border-frenz-line bg-frenz-card"),
        )}
      >
        {filled ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL has no remote loader to optimise */}
            <img src={preview ?? value ?? ""} alt="Your photo" className="block max-h-72 w-full object-contain" />
            {busy ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/70" role="status">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-600 motion-reduce:animate-none" aria-hidden />
                <span className="text-[12.5px] font-semibold text-foreground/80">Uploading image…</span>
              </div>
            ) : null}
            <div className="absolute right-2 top-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12.5px] font-semibold text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Replace
              </button>
              <button
                type="button"
                onClick={clear}
                aria-label="Remove image"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn("flex w-full flex-col items-center justify-center gap-1.5 px-4 text-center transition active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet", large ? "min-h-[13rem] py-8" : "min-h-[10rem] py-6")}
          >
            <span className={cn("mb-1 inline-flex items-center justify-center text-white", large ? "h-14 w-14 rounded-2xl bg-frenz-gradient" : "h-10 w-10 rounded-xl bg-frenz-violet")}>
              <ImagePlus className={large ? "h-6 w-6" : "h-[18px] w-[18px]"} aria-hidden />
            </span>
            <span className={cn("font-bold text-frenz-ink", large ? "font-heading text-[18px]" : "text-[14.5px]")}>Choose a photo</span>
            {/* one file input: on a phone it offers Photos, Files and the camera itself */}
            <span className="text-[13px] text-frenz-muted">{large ? "From Photos, Files or your camera" : "or drag one here"}</span>
          </button>
        )}
      </div>
      {meta && !problem ? (
        <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">
          {meta.name} · {(meta.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      ) : null}
      {note ? <p className="m-0 mt-2 px-1 text-[12.5px] text-frenz-muted">{note}</p> : null}
      {problem ? (
        <p className="mt-1.5 text-[12px] font-medium text-rose-600" role="alert">
          {problem}
        </p>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept.join(",")}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
