"use client";

import { Link2, UploadCloud } from "lucide-react";
import { useId, useRef, useState } from "react";

import { AI_CLEAN_ACCEPT, AI_CLEAN_FORMAT_LINE } from "@/lib/ai/clean-media";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * The drop zone.
 *
 * ── The control is the input, the target is the label ─────────────────────────
 *
 * The whole panel is a `<label>` for a visually-hidden `<input type="file">`.
 * That one decision buys every requirement at once and invents nothing:
 *
 *   • tap anywhere on the panel → the native picker opens, on every platform,
 *     including iOS where a scripted `.click()` outside a user gesture does not;
 *   • the real `<input>` is what receives keyboard focus, so Space/Enter open the
 *     picker with no key handling of our own, and `peer-focus-visible` paints the
 *     ring on the panel the person can actually see;
 *   • a screen reader announces one labelled file input rather than a div
 *     pretending to be a button.
 *
 * The obvious alternative — a `<button>` wrapping everything — cannot hold the
 * "Choose Video" button inside it (nested interactive elements), and would leave
 * the drop zone unlabelled.
 *
 * ── Drag state is counted, not toggled ────────────────────────────────────────
 *
 * `dragover`/`dragleave` fire for every child element the pointer crosses, so a
 * boolean flickers off the moment the cursor passes over the icon. A depth
 * counter is the standard fix and the reason the highlight holds steady.
 *
 * Nothing here uploads. The chosen file is handed straight up to the workspace,
 * which is the only place that knows what to do with it.
 */
export function AICleanUpload({
  onFile,
  onPasteLink,
}: {
  onFile: (file: File) => void;
  /** Switches the stage to the link field. */
  onPasteLink: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const take = (file: File | null | undefined) => {
    if (!file) return;
    haptic("light");
    onFile(file);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        // Without this the browser navigates to the dropped file instead.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={AI_CLEAN_ACCEPT}
        className="peer sr-only"
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Let the same file be chosen twice in a row — without this, picking
          // the file you just removed fires no change event at all.
          e.target.value = "";
        }}
      />

      <label
        htmlFor={inputId}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-5 py-10 text-center transition-colors duration-200 sm:py-14",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          dragging
            ? "border-primary bg-primary/[0.06]"
            : "border-border bg-secondary/25 hover:border-primary/40 hover:bg-secondary/40",
        )}
      >
        <span
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-200 motion-reduce:transform-none",
            dragging ? "bg-brand-tile text-white scale-105" : "bg-secondary text-muted-foreground",
          )}
        >
          <UploadCloud className="h-7 w-7" aria-hidden />
        </span>

        <span className="mt-4 block text-base font-semibold sm:text-lg">
          {dragging ? "Drop it anywhere here" : "Drop your video here"}
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">or choose a video from your device</span>

        {/* A span, not a button: a button inside a label swallows the click on
            some browsers, and this one only has to LOOK like the primary action
            — the label around it is what opens the picker. */}
        <span className="btn-lux btn-lux-primary mt-5">Choose Video</span>

        {/* Not `uppercase`: the owner writes it "WebM", and a CSS transform that
            renders it "WEBM" is a silent edit of their copy. */}
        <span className="mt-5 block text-[11px] font-medium tracking-[0.12em] text-muted-foreground/70">
          {AI_CLEAN_FORMAT_LINE}
        </span>
      </label>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onPasteLink();
          }}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Paste video link
        </button>
      </div>
    </div>
  );
}
