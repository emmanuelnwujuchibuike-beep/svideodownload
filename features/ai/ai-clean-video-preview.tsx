"use client";

import { ArrowRight, RefreshCcw, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { AI_CLEAN_ACCEPT, formatResolution, type AICleanErrorCode } from "@/lib/ai/clean-media";
import { haptic } from "@/lib/motion/haptics";
import { formatBytes, formatDuration } from "@/lib/utils";

/**
 * The chosen video, before anything happens to it.
 *
 * ── The metadata is measured, never assumed ───────────────────────────────────
 *
 * Duration and resolution come from the `<video>` element's own `loadedmetadata`
 * event — the same read `features/create/composer-core.ts` does before a post is
 * published. Until that fires, and for a container the browser can decode audio
 * from but not size, the value is null and renders as an em-dash. This codebase's
 * standing rule: an absent measurement never renders as a zero, because "not
 * measured" and "measured as nothing" are different claims and a surface that
 * confuses them teaches its reader to distrust it.
 *
 * `preload="metadata"` is what makes this cheap: the browser reads the header
 * and the first frame for the poster, not the file. A 90 MB clip costs a few
 * hundred kilobytes of decode to preview.
 *
 * ── `error` on the element is the honest "invalid video" signal ───────────────
 *
 * A file can pass every name and size check and still be unopenable — truncated,
 * or a container this browser has no decoder for. That is only discoverable by
 * asking the browser to open it, which is exactly what this element does, so the
 * failure is reported up rather than left as a black rectangle.
 */
export function AICleanVideoPreview({
  file,
  objectUrl,
  onChange,
  onRemove,
  onContinue,
  onInvalid,
}: {
  file: File;
  /** Owned by the workspace, which is also what revokes it. */
  objectUrl: string;
  /** A different file was picked from here. */
  onChange: (file: File) => void;
  onRemove: () => void;
  onContinue: () => void;
  onInvalid: (code: AICleanErrorCode) => void;
}) {
  const inputId = useId();
  const [duration, setDuration] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const resolution = formatResolution(width, height);

  return (
    <div className="p-4 sm:p-6">
      <div className="overflow-hidden rounded-2xl bg-black/90 motion-safe:animate-fade-up">
        <video
          ref={videoRef}
          src={objectUrl}
          controls
          playsInline
          preload="metadata"
          // Never autoplay a preview: it costs bandwidth on a mobile connection
          // for a file the person is about to hand to a tool, not watch.
          className="mx-auto block max-h-[46vh] w-full object-contain"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDuration(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
            setWidth(v.videoWidth || null);
            setHeight(v.videoHeight || null);
          }}
          onError={() => onInvalid("invalid-video")}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="File" value={file.name} truncate />
        <Fact label="Length" value={duration === null ? null : formatDuration(duration)} />
        <Fact label="Size" value={formatBytes(file.size)} />
        <Fact label="Resolution" value={resolution} />
      </dl>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            onContinue();
          }}
          className="btn-lux btn-lux-primary w-full sm:w-auto"
        >
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="file"
            accept={AI_CLEAN_ACCEPT}
            className="peer sr-only"
            onChange={(e) => {
              const next = e.target.files?.[0];
              e.target.value = "";
              if (next) {
                haptic("light");
                onChange(next);
              }
            }}
          />
          <label
            htmlFor={inputId}
            className="btn-lux btn-lux-secondary cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[hsl(var(--ring))]"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden />
            Change video
          </label>

          <button
            type="button"
            onClick={() => {
              haptic("light");
              onRemove();
            }}
            className="btn-lux btn-lux-secondary text-muted-foreground"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/** One measured fact. `null` is an em-dash — see the note at the top. */
function Fact({ label, value, truncate }: { label: string; value: string | null; truncate?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium ${truncate ? "truncate" : "tabular-nums"}`} title={truncate && value ? value : undefined}>
        {value ?? <span className="text-muted-foreground">&mdash;</span>}
      </dd>
    </div>
  );
}
