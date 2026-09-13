"use client";

import { RefreshCw, Trash2 } from "lucide-react";

import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import type { SourceVideo } from "@/lib/ai/character-replace/types";
import { AI_VIDEO_ACCEPT, AI_VIDEO_FORMAT_LINE, formatDuration, formatResolution, type AiMediaErrorCode } from "@/lib/ai/media";
import { formatBytes } from "@/lib/utils";

/**
 * Step 2 — the video to transform.
 *
 * Chosen: a native player (controls, never autoplay, `playsInline` so a phone
 * does not hijack the screen), the three facts the owner named — duration,
 * resolution, file size — and change/remove. An unmeasured fact renders as an
 * em-dash rather than a zero; "not measured" and "measured as nothing" are
 * different claims.
 */
export function CharacterReplaceVideoStep({
  video,
  busy,
  error,
  maxDurationSeconds,
  onPick,
  onClear,
}: {
  video: SourceVideo | null;
  busy: boolean;
  error: AiMediaErrorCode | null;
  /** From the server's config; null until it answers. */
  maxDurationSeconds: number | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  if (!video) {
    return (
      <div>
        <CharacterReplaceMediaPicker
          kind="video"
          accept={AI_VIDEO_ACCEPT}
          title="Upload your video"
          hint="Choose the video you want to transform."
          formats={AI_VIDEO_FORMAT_LINE}
          busy={busy}
          error={error}
          onPick={onPick}
        />
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          The person in this video is who gets replaced. Their movement, expressions, the scene and the camera stay as
          they are.
          {maxDurationSeconds !== null ? ` Up to ${formatDuration(maxDurationSeconds)} long — longer videos can be trimmed in the next step.` : ""}
        </p>
      </div>
    );
  }

  const tooLong = maxDurationSeconds !== null && video.durationSeconds !== null && video.durationSeconds > maxDurationSeconds;

  return (
    <div>
      <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card">
        <div className="bg-[#0b0f1a]">
          <video
            src={video.objectUrl}
            controls
            playsInline
            preload="metadata"
            className="mx-auto block max-h-[min(60vh,28rem)] w-full object-contain"
          />
        </div>
        <dl className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
          <Fact label="Duration" value={formatDuration(video.durationSeconds) ?? "—"} />
          <Fact label="Resolution" value={formatResolution(video.width, video.height) ?? "—"} />
          <Fact label="Size" value={formatBytes(video.size)} />
        </dl>
      </div>

      {tooLong ? (
        <p role="status" className="mt-3 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] px-4 py-3 text-[12.5px] leading-relaxed">
          <span className="font-bold">Longer than {formatDuration(maxDurationSeconds)}.</span>{" "}
          <span className="text-muted-foreground">
            That is fine — the next step lets you choose which {formatDuration(maxDurationSeconds)} to keep.
          </span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="btn-lux cursor-pointer border border-border/70 bg-card text-foreground hover:border-foreground/25">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Change video
          <input
            type="file"
            accept={AI_VIDEO_ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={onClear}
          className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Remove
        </button>
      </div>
      <p className="mt-3 truncate text-[12px] text-muted-foreground" title={video.name}>
        {video.name}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
