"use client";

import { RefreshCw, Trash2 } from "lucide-react";

import { CharacterReplaceInputDirection } from "@/features/ai/character-replace/input-direction";
import { CharacterReplaceInputSummary } from "@/features/ai/character-replace/input-summary";
import { CharacterReplaceTutorialButton } from "@/features/ai/character-replace/tutorial-example";
import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { AssetSlot, CharacterReplaceProject } from "@/lib/ai/character-replace/types";
import { CHARACTER_REPLACE_VIDEO_ACCEPT, CHARACTER_REPLACE_VIDEO_FORMAT_LINE } from "@/lib/ai/character-replace/validate";
import { formatDuration, formatResolution, type AiMediaErrorCode } from "@/lib/ai/media";
import { formatBytes } from "@/lib/utils";

/**
 * Step 2 — the video to transform.
 *
 * Empty / invalid / error: the picker, with the refusal under it in the media
 * module's words. Validating: the picker, busy. Ready: a native player
 * (controls, never autoplay, `playsInline` so a phone does not hijack the
 * screen), the facts the owner named — duration, resolution, aspect, size —
 * and change/remove. An unmeasured fact renders as an em-dash rather than a
 * zero; "not measured" and "measured as nothing" are different claims.
 *
 * Once both files are in, the input summary (§15) follows so the member sees
 * what they are about to continue with.
 */
export function CharacterReplaceVideoStep({
  project,
  slot,
  config,
  onPick,
  onClear,
}: {
  project: CharacterReplaceProject;
  slot: AssetSlot;
  config: CharacterReplacePublicConfig | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const video = project.video;
  const maxDurationSeconds = config?.maximumDurationSeconds ?? null;

  if (!video) {
    const refusal = slot.status === "invalid" || slot.status === "error" ? (slot.code as AiMediaErrorCode) : null;
    return (
      <div>
        {/* the owner's red direction (2026-09-14): the exact kind of video this mode wants */}
        <div className="mb-4 space-y-2">
          <CharacterReplaceInputDirection kind="video" mode={project.mode} />
          <CharacterReplaceTutorialButton kind="video" mode={project.mode} />
        </div>
        <CharacterReplaceMediaPicker
          kind="video"
          accept={CHARACTER_REPLACE_VIDEO_ACCEPT}
          title="Upload your video"
          hint="Choose the video you want to transform."
          formats={CHARACTER_REPLACE_VIDEO_FORMAT_LINE}
          busy={slot.status === "validating" || slot.status === "uploading"}
          error={refusal}
          onPick={onPick}
        />
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          The person in this video is who gets replaced. Their movement, expressions, the scene and the camera stay as
          they are.
          {maxDurationSeconds !== null ? ` Up to ${formatDuration(maxDurationSeconds)} long — longer videos can be trimmed in the next step.` : ""}
          {config?.maximumUploadBytes ? ` Files up to ${Math.round(config.maximumUploadBytes / (1024 * 1024))} MB.` : ""}
        </p>
        {/* The limit that actually applied, in the refusal — the generic copy names the platform ceiling. */}
        {refusal === "file-too-large" && config?.maximumUploadBytes ? (
          <p role="status" className="mt-2 text-[12.5px] font-semibold text-rose-500">
            This video is over {Math.round(config.maximumUploadBytes / (1024 * 1024))} MB. Trim it or export a smaller version first.
          </p>
        ) : null}
      </div>
    );
  }

  const meta = video.metadata;
  const durationSeconds = meta.durationMs === null ? null : meta.durationMs / 1000;
  const tooLong = maxDurationSeconds !== null && durationSeconds !== null && durationSeconds > maxDurationSeconds;
  const resolution =
    meta.resolutionLabel && meta.width && meta.height ? `${meta.resolutionLabel}` : (formatResolution(meta.width, meta.height) ?? "—");

  return (
    <div>
      <div className="mb-4 space-y-2">
          <CharacterReplaceInputDirection kind="video" mode={project.mode} />
          <CharacterReplaceTutorialButton kind="video" mode={project.mode} />
        </div>
      <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card">
        <div className="bg-[#0b0f1a]">
          <video
            key={video.objectUrl}
            src={video.objectUrl}
            controls
            playsInline
            preload="metadata"
            className="mx-auto block max-h-[min(60vh,28rem)] w-full object-contain"
          />
        </div>
        <dl className="grid grid-cols-2 divide-x divide-y divide-border/60 border-t border-border/60 sm:grid-cols-4 sm:divide-y-0">
          <Fact label="Duration" value={formatDuration(durationSeconds) ?? "—"} />
          <Fact label="Resolution" value={resolution} sub={meta.resolutionLabel ? formatResolution(meta.width, meta.height) : null} />
          <Fact label="Aspect" value={meta.aspect?.label ?? "—"} sub={meta.aspect ? meta.aspect.orientation : null} />
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
            accept={CHARACTER_REPLACE_VIDEO_ACCEPT}
            className="sr-only"
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
        <span className="ml-auto min-w-0 max-w-[50%] truncate text-[12px] text-muted-foreground" title={video.name}>
          {video.name}
        </span>
      </div>

      <CharacterReplaceInputSummary project={project} config={config} className="mt-5" />
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-semibold tabular-nums">{value}</dd>
      {sub ? <dd className="text-[10.5px] capitalize text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}
