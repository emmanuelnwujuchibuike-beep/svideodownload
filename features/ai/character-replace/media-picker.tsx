"use client";

import { ImagePlus, Loader2, Video } from "lucide-react";
import { useCallback, useId, useRef, useState, type DragEvent } from "react";

import { AI_MEDIA_ERRORS, type AiMediaErrorCode } from "@/lib/ai/media";
import { cn } from "@/lib/utils";

/**
 * One picker for both files.
 *
 * A real `<input type="file">` does the work — the keyboard reaches it, a
 * phone opens its gallery from it, and screen readers announce it — and the
 * panel around it is the visible target. Drag-and-drop is layered on for a
 * desktop, never required. Validation is announced in a live region under
 * the panel, in the media module's own words (title, sentence, way out).
 *
 * `busy` is the decoding moment after a pick: the browser is reading the
 * file's size and length. It is a short, real wait, so it gets a spinner and
 * the panel refuses a second pick until it is over.
 */
export function CharacterReplaceMediaPicker({
  kind,
  accept,
  title,
  hint,
  formats,
  busy = false,
  error,
  onPick,
  className,
}: {
  kind: "photo" | "video";
  accept: string;
  title: string;
  hint: string;
  /** "JPG · PNG · WebP" */
  formats: string;
  busy?: boolean;
  error: AiMediaErrorCode | null;
  onPick: (file: File) => void;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const Icon = kind === "photo" ? ImagePlus : Video;

  const take = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file && !busy) onPick(file);
      // So the same file can be chosen again after a refusal.
      if (inputRef.current) inputRef.current.value = "";
    },
    [busy, onPick],
  );

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    take(e.dataTransfer?.files ?? null);
  };

  const copy = error ? AI_MEDIA_ERRORS[error] : null;

  return (
    <div className={className}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="peer sr-only"
        disabled={busy}
        onChange={(e) => take(e.target.files)}
        aria-describedby={copy ? `${inputId}-error` : undefined}
      />
      <label
        htmlFor={inputId}
        onDragEnter={onDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "group relative flex min-h-[13rem] cursor-pointer flex-col items-center justify-center rounded-[1.5rem] px-6 py-8 text-center sm:min-h-[15rem]",
          "border border-dashed border-border bg-card/70 transition-colors duration-200",
          "hover:border-foreground/30 hover:bg-card",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          dragging && "border-primary/60 bg-primary/[0.04]",
          busy && "cursor-progress",
          copy && "border-rose-400/60",
        )}
      >
        <span
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-foreground/80 transition-transform duration-200 motion-safe:group-hover:scale-105",
            dragging && "bg-primary/10 text-primary",
          )}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Icon className="h-6 w-6" aria-hidden />
          )}
        </span>
        <span className="mt-4 text-[15.5px] font-bold tracking-[-0.01em]">{busy ? "Reading your file…" : title}</span>
        <span className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">{hint}</span>
        <span className="mt-4 inline-flex items-center rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {formats}
        </span>
      </label>

      {/* Announced, and left on screen: a refusal that vanishes cannot be read. */}
      <div id={`${inputId}-error`} role="status" aria-live="polite" className="min-h-[1px]">
        {copy ? (
          <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/[0.05] px-4 py-3">
            <p className="text-[13.5px] font-bold">{copy.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 text-[12.5px] font-semibold text-primary underline-offset-4 hover:underline"
            >
              {copy.action}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
