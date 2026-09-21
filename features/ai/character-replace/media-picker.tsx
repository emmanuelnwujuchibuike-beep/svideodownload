"use client";

import { ImagePlus, Loader2, Video } from "lucide-react";
import { useCallback, useId, useRef, useState, type DragEvent, type ReactNode } from "react";

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
  guidance = null,
  onPick,
  onPickMany,
  multiple = false,
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
  /** 2026-09-20: what the chosen replacement type needs from the photo, shown under a refusal with the drawn example one tap away. */
  guidance?: { best: string; example: ReactNode } | null;
  onPick: (file: File) => void;
  /** 0166 (multi-video): with `multiple`, every chosen or dropped file at once. Falls back to `onPick` per file when absent. */
  onPickMany?: (files: File[]) => void;
  multiple?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const Icon = kind === "photo" ? ImagePlus : Video;

  const take = useCallback(
    (files: FileList | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length && !busy) {
        if (multiple && onPickMany) onPickMany(list);
        else if (list[0]) onPick(list[0]);
      }
      // So the same file can be chosen again after a refusal.
      if (inputRef.current) inputRef.current.value = "";
    },
    [busy, multiple, onPick, onPickMany],
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
        multiple={multiple}
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
          "group relative flex min-h-[14rem] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[1.75rem] px-6 py-9 text-center sm:min-h-[16rem]",
          "border border-border/70 bg-card shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-[border-color,box-shadow,transform] duration-200",
          "hover:border-foreground/25 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.55)] active:scale-[0.995]",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          dragging && "border-primary/60 shadow-[0_0_0_4px_rgb(99_102_241/0.15)]",
          busy && "cursor-progress",
          copy && "border-rose-400/60",
        )}
      >
        {/* a soft glow behind the tile — the editor's idle state, not a form field */}
        <span aria-hidden className="pointer-events-none absolute -top-16 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500/15 via-indigo-500/15 to-fuchsia-500/15 blur-3xl" />
        <span
          className={cn(
            "relative flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white shadow-[0_12px_28px_-12px_rgba(79,70,229,0.6)] transition-transform duration-200 motion-safe:group-hover:scale-105",
            dragging && "scale-105",
          )}
        >
          {busy ? (
            <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Icon className="h-7 w-7" strokeWidth={2.2} aria-hidden />
          )}
        </span>
        <span className="relative mt-4 text-[16px] font-bold tracking-[-0.015em]">{busy ? "Reading your file…" : title}</span>
        <span className="relative mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">{hint}</span>
        <span className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[9.5px] text-background">Tap</span>
          {formats}
        </span>
      </label>

      {/* Announced, and left on screen: a refusal that vanishes cannot be read. */}
      <div id={`${inputId}-error`} role="status" aria-live="polite" className="min-h-[1px]">
        {copy ? (
          <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/[0.05] px-4 py-3">
            <p className="text-[13.5px] font-bold">{copy.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</p>
            {guidance && (error === "image-wrong-framing" || error === "image-too-small") ? (
              <p className="mt-1.5 text-[12.5px] font-semibold text-foreground">{guidance.best}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-[12.5px] font-semibold text-primary underline-offset-4 hover:underline"
              >
                {copy.action}
              </button>
              {guidance && (error === "image-wrong-framing" || error === "image-too-small") ? guidance.example : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
