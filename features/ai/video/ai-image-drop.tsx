"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

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
  className?: string;
}

const EXT = (mime: string) => mime.replace("image/", "").toUpperCase();

export function AiImageDrop({ value, onChange, upload, label, hint, accept = ["image/jpeg", "image/png"], maxBytes, optional, className }: AiImageDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [meta, setMeta] = useState<{ name: string; size: number } | null>(null);

  const clear = useCallback(() => {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    setMeta(null);
    setProblem(null);
    onChange(null);
  }, [onChange]);

  const take = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setProblem(null);
      // 🔴 Refused BEFORE the upload: the member learns instantly, and we do not
      // spend bandwidth on a file the vendor would reject anyway.
      if (!accept.includes(file.type)) {
        setProblem(`That file type isn't supported. Use ${accept.map(EXT).join(" or ")}.`);
        return;
      }
      if (file.size > maxBytes) {
        setProblem(`That image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
        return;
      }
      const local = URL.createObjectURL(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return local;
      });
      setMeta({ name: file.name, size: file.size });
      setBusy(true);
      try {
        onChange(await upload(file));
      } catch {
        setProblem("That image couldn't be uploaded. Try again.");
        onChange(null);
      } finally {
        setBusy(false);
      }
    },
    [accept, maxBytes, onChange, upload],
  );

  const filled = !!preview || !!value;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">
          {label}
          {optional ? <span className="ml-1.5 font-medium text-muted-foreground">Optional</span> : null}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {accept.map(EXT).join(" · ")} · up to {Math.round(maxBytes / (1024 * 1024))} MB
        </span>
      </div>
      {hint ? <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}

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
          "relative mt-2 overflow-hidden rounded-2xl transition",
          filled ? "ring-1 ring-inset ring-black/[0.08]" : "border-2 border-dashed",
          !filled && (dragging ? "border-violet-400 bg-violet-50/70" : "border-violet-300/60 bg-white/55"),
        )}
      >
        {filled ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL has no remote loader to optimise */}
            <img src={preview ?? value ?? ""} alt="" className="block max-h-64 w-full object-contain" />
            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/65 backdrop-blur-[2px]">
                <Loader2 className="h-5 w-5 animate-spin text-violet-600 motion-reduce:animate-none" aria-label="Uploading" />
              </div>
            ) : null}
            <button
              type="button"
              onClick={clear}
              aria-label="Remove image"
              className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-[9rem] w-full flex-col items-center justify-center gap-2 px-4 py-6 text-center transition active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600">
              <ImagePlus className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-[14px] font-semibold">Choose a photo</span>
            <span className="text-[12px] text-muted-foreground">or drag one here</span>
          </button>
        )}
      </div>

      {meta && !problem ? (
        <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">
          {meta.name} · {(meta.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      ) : null}
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
        onChange={(e) => {
          void take(e.target.files?.[0]);
          // Reset so choosing the SAME file twice still fires a change.
          e.target.value = "";
        }}
      />
    </div>
  );
}
