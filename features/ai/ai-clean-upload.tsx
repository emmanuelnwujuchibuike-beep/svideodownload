"use client";

import { ArrowRight, Link2, UploadCloud } from "lucide-react";
import { useId, useRef, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
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
  showPasteLink = true,
}: {
  onFile: (file: File) => void;
  /** Switches the stage to the link field. */
  onPasteLink: () => void;
  /** False on the input page, which draws its own link pill below the card. */
  showPasteLink?: boolean;
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
          "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[1.5rem] border-2 border-dashed px-5 py-9 text-center transition-colors duration-200 sm:py-12",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          dragging
            ? "border-primary bg-primary/[0.07]"
            : "border-border/70 bg-card/55 backdrop-blur hover:border-primary/40",
        )}
      >
        {/* The light inside the card, from `public/ai input page.jpg`. Static. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 45% at 50% 30%, rgba(129,140,248,0.16) 0%, transparent 70%)," +
              "radial-gradient(40% 35% at 88% 88%, rgba(217,70,239,0.12) 0%, transparent 70%)",
          }}
        />

        {/*
          The mark in a lit sphere with a ring around it, as drawn — replacing a
          grey tile and a cloud glyph. It is the same brand mark the rest of the
          feature uses, at 30px, so it costs nothing new.
        */}
        <span className="relative flex h-20 w-20 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-gradient-to-br from-white/80 to-indigo-100/60 ring-1 ring-inset ring-white/70 dark:from-white/15 dark:to-indigo-500/15 dark:ring-white/20"
            style={{ boxShadow: "0 10px 34px -10px rgba(99,102,241,0.65)" }}
          />
          {/* the orbit ring: a wide, flat ellipse behind the sphere */}
          <span
            aria-hidden
            className="absolute inset-x-[-28%] top-1/2 h-8 -translate-y-1/2 rounded-[50%] border border-indigo-300/45 dark:border-indigo-300/25"
          />
          <span className={cn("relative transition-transform duration-200 motion-reduce:transform-none", dragging && "scale-110")}>
            <FrenzLogo size={34} alt="" />
          </span>
        </span>

        <span className="mt-4 block text-lg font-bold sm:text-xl">
          {dragging ? "Drop it anywhere here" : "Drop your video here"}
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">or choose a video from your device</span>

        {/* A span, not a button: a button inside a label swallows the click on
            some browsers, and this one only has to LOOK like the primary action
            — the label around it is what opens the picker. */}
        <span
          className={cn(
            "mt-5 inline-flex items-center gap-2 rounded-full px-7 py-3.5",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500",
            "text-sm font-bold text-white shadow-[0_14px_32px_-12px_rgb(99_102_241/0.95)]",
          )}
        >
          <UploadCloud className="h-4 w-4" aria-hidden />
          Choose Video
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>

        {/* Not `uppercase`: the owner writes it "WebM", and a CSS transform that
            renders it "WEBM" is a silent edit of their copy. */}
        <span className="mt-5 block text-[11px] font-medium tracking-[0.12em] text-muted-foreground/70">
          {AI_CLEAN_FORMAT_LINE}
        </span>
      </label>

      {/*
        🔴 SUPPRESSIBLE, because the input page draws this itself.

        `public/ai input page.jpg` puts "Paste video link" BELOW the card as its
        own pill. Rendering the built-in one too printed it twice on the same
        screen — caught in a screenshot, invisible in review. Default stays on
        so every other caller is unchanged.
      */}
      {showPasteLink ? (
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
      ) : null}
    </div>
  );
}
