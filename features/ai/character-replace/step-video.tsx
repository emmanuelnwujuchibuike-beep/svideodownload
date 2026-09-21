"use client";

import { Plus, RefreshCw, Trash2, X } from "lucide-react";

import { CharacterReplaceInputDirection } from "@/features/ai/character-replace/input-direction";
import { CharacterReplaceInputSummary } from "@/features/ai/character-replace/input-summary";
import { CharacterReplaceTutorialButton } from "@/features/ai/character-replace/tutorial-example";
import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { AssetSlot, CharacterReplaceProject, SourceVideo } from "@/lib/ai/character-replace/types";
import { CHARACTER_REPLACE_VIDEO_ACCEPT, CHARACTER_REPLACE_VIDEO_FORMAT_LINE } from "@/lib/ai/character-replace/validate";
import { AI_MEDIA_ERRORS, formatDuration, formatResolution, type AiMediaErrorCode } from "@/lib/ai/media";
import { cn, formatBytes } from "@/lib/utils";

/**
 * The video step — one video as before, and since 2026-09-21 (multi-video
 * brief §2) several: multiple selection, drag and drop, a preview per video
 * with its name, size and length, remove one, clear all, add more. Nothing
 * is uploaded here; "Process N videos" on the review step is the only
 * thing that starts anything.
 */
export interface VideoStepBatch {
  /** The operator's queue is on and the batch ceiling is above one. */
  multiAllowed: boolean;
  maxVideos: number;
  /** How many more this member may add right now (their open jobs count against the ceiling); null until the balance answers. */
  canAdd: number | null;
  extras: readonly SourceVideo[];
  pickErrors: readonly { name: string; code: AiMediaErrorCode | "too-many" | "video-too-long" }[];
  onPickMany: (files: File[]) => void;
  onRemoveExtra: (index: number) => void;
  onClearAll: () => void;
  onDismissErrors: () => void;
}

export function CharacterReplaceVideoStep({
  project,
  slot,
  config,
  onPick,
  onClear,
  batch,
}: {
  project: CharacterReplaceProject;
  slot: AssetSlot;
  config: CharacterReplacePublicConfig | null;
  onPick: (file: File) => void;
  onClear: () => void;
  batch?: VideoStepBatch;
}) {
  const video = project.video;
  const maxDurationSeconds = config?.maximumDurationSeconds ?? null;
  const multi = !!batch?.multiAllowed;
  const total = (video ? 1 : 0) + (batch?.extras.length ?? 0);
  const room = batch ? Math.max(0, Math.min(batch.maxVideos, batch.canAdd ?? batch.maxVideos) - total) : 0;

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
          title={multi ? "Upload your videos" : "Upload your video"}
          hint={multi ? `Choose one video, or up to ${batch!.maxVideos} to transform with the same photo.` : "Choose the video you want to transform."}
          formats={CHARACTER_REPLACE_VIDEO_FORMAT_LINE}
          busy={slot.status === "validating" || slot.status === "uploading"}
          error={refusal}
          onPick={onPick}
          multiple={multi}
          onPickMany={batch?.onPickMany}
        />
        {batch ? <PickErrors errors={batch.pickErrors} onDismiss={batch.onDismissErrors} maxDurationSeconds={maxDurationSeconds} /> : null}
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          The person in this video is who gets replaced. Their movement, expressions, the scene and the camera stay as
          they are.
          {maxDurationSeconds !== null ? ` Up to ${formatDuration(maxDurationSeconds)} long — a single longer video can be trimmed in the next step.` : ""}
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
  const extras = batch?.extras ?? [];

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

      {tooLong && extras.length === 0 ? (
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
        {multi && room > 0 ? (
          <label className="btn-lux cursor-pointer border border-border/70 bg-card text-foreground hover:border-foreground/25">
            <Plus className="h-4 w-4" aria-hidden />
            Add videos
            <input
              type="file"
              accept={CHARACTER_REPLACE_VIDEO_ACCEPT}
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length) batch!.onPickMany(files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
        <button
          type="button"
          onClick={extras.length ? batch!.onClearAll : onClear}
          className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {extras.length ? "Clear all" : "Remove"}
        </button>
        <span className="ml-auto min-w-0 max-w-[50%] truncate text-[12px] text-muted-foreground" title={video.name}>
          {extras.length ? `${total} videos` : video.name}
        </span>
      </div>

      {/* 0166: the session — every video with its facts; the first is the one previewed above */}
      {multi && (extras.length > 0 || room > 0) ? (
        <div className="mt-4 rounded-[1.35rem] border border-border/70 bg-card">
          <div className="flex items-center justify-between px-4 pt-3.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {total} of {Math.min(batch!.maxVideos, batch!.canAdd !== null ? batch!.canAdd + total : batch!.maxVideos)} videos
            </p>
            {extras.length > 0 ? <p className="text-[11.5px] text-muted-foreground">Same photo and settings for every video · each runs at full length</p> : null}
          </div>
          <ul className="mt-2 divide-y divide-border/60">
            {[video, ...extras].map((v, i) => {
              const secs = v.metadata.durationMs === null ? null : v.metadata.durationMs / 1000;
              const over = maxDurationSeconds !== null && secs !== null && secs > maxDurationSeconds && extras.length > 0;
              return (
                <li key={`${v.name}|${v.size}`} className="flex items-center gap-3 px-4 py-2.5">
                  <video src={v.objectUrl} muted playsInline preload="metadata" className="h-14 w-10 shrink-0 rounded-lg bg-[#0b0f1a] object-cover ring-1 ring-black/10 dark:ring-white/10" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold" title={v.name}>
                      <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-[10.5px] font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                      {v.name}
                    </p>
                    <p className={cn("mt-0.5 text-[11.5px]", over ? "font-semibold text-rose-500" : "text-muted-foreground")}>
                      {formatDuration(secs) ?? "—"} · {formatBytes(v.size)}
                      {v.metadata.resolutionLabel ? ` · ${v.metadata.resolutionLabel}` : ""}
                      {over ? ` · longer than ${formatDuration(maxDurationSeconds)} — remove it or process it on its own` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => (i === 0 ? onClear() : batch!.onRemoveExtra(i - 1))}
                    aria-label={`Remove ${v.name}`}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          {room > 0 ? (
            <label className="mx-4 mb-4 mt-2 flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 text-[13px] font-semibold text-muted-foreground hover:border-foreground/30 hover:text-foreground">
              <Plus className="h-4 w-4" aria-hidden />
              Add {extras.length ? "more" : "another"} — up to {room} more
              <input
                type="file"
                accept={CHARACTER_REPLACE_VIDEO_ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length) batch!.onPickMany(files);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="px-4 pb-4 pt-2 text-[11.5px] text-muted-foreground">That&apos;s the most you can have in progress at once.</p>
          )}
        </div>
      ) : null}
      {batch ? <PickErrors errors={batch.pickErrors} onDismiss={batch.onDismissErrors} maxDurationSeconds={maxDurationSeconds} /> : null}

      <CharacterReplaceInputSummary project={project} config={config} className="mt-5" />
    </div>
  );
}

/** The files that were not taken, each with its own reason — left on screen until dismissed. */
function PickErrors({ errors, onDismiss, maxDurationSeconds }: { errors: readonly { name: string; code: AiMediaErrorCode | "too-many" | "video-too-long" }[]; onDismiss: () => void; maxDurationSeconds: number | null }) {
  if (!errors.length) return null;
  const reason = (code: AiMediaErrorCode | "too-many" | "video-too-long") =>
    code === "too-many"
      ? "over the limit for one session"
      : code === "video-too-long"
        ? `longer than ${formatDuration(maxDurationSeconds) ?? "the limit"} — several videos run at full length, so process this one on its own`
        : (AI_MEDIA_ERRORS[code]?.title ?? "couldn't be used");
  return (
    <div role="status" className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/[0.05] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-bold">{errors.length === 1 ? "One video wasn't added" : `${errors.length} videos weren't added`}</p>
        <button type="button" onClick={onDismiss} className="text-[12px] font-semibold text-muted-foreground hover:text-foreground">
          Dismiss
        </button>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
        {errors.slice(0, 6).map((e, i) => (
          <li key={`${e.name}-${i}`} className="truncate">
            <span className="font-semibold text-foreground">{e.name}</span> — {reason(e.code)}
          </li>
        ))}
        {errors.length > 6 ? <li>…and {errors.length - 6} more</li> : null}
      </ul>
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
