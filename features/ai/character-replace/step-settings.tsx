"use client";

import { Info, Pause, Play, RotateCcw, Scissors } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { VideoGenerationCostPreview } from "@/features/ai/character-replace/video-generation-cost-preview";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality } from "@/lib/ai/character-replace/pricing";
import type { CharacterReplaceProject, PricingState } from "@/lib/ai/character-replace/types";
import { qualityGuidance } from "@/lib/ai/character-replace/validate";
import {
  formatClock,
  formatSeconds,
  originalDurationSeconds,
  selectedDurationSeconds,
  trimmedSeconds,
  videoFits,
} from "@/lib/ai/character-replace/workspace";
import { cn } from "@/lib/utils";

/**
 * Step 3 — output settings.
 *
 * ── Quality: a segmented control, drawn from the server's list ──────────────
 *
 * The buttons are whatever `config.qualities` contains, in its order, with
 * its labels and hints. A tier the operator switches off is simply not here.
 * When the chosen tier asks for more pixels than the source holds, one
 * sentence says so (§13) — a note, never a refusal: the server decides the
 * real output resolution.
 *
 * ── Trim VIDEO, not crop (§11) ──────────────────────────────────────────────
 *
 * Trimming shortens the DURATION, which is what a per-second price bills.
 * Spatial cropping is a different thing and is not offered; the heading says
 * "Trim video" so nobody expects it. Two range inputs — keyboard-operable,
 * finger-sized — choose the kept range over the source. The clock under them
 * reads `00:03.2 — 00:13.2`, the selected duration is computed from the same
 * integer milliseconds the job input will carry, and Reset puts the whole
 * video back.
 *
 * ── The preview scrubs, and it is the ONLY second decoder ───────────────────
 *
 * A muted, `preload="metadata"` player above the handles seeks to whichever
 * handle moved, so the member sees the frame they are cutting at. The video
 * step's own player is unmounted on this step, so exactly one `<video>` is
 * alive at a time (§18: "Do not repeatedly decode the video").
 *
 * ── 🔴 NOTHING IS CUT (§10) ─────────────────────────────────────────────────
 *
 * The source file is untouched. The trim is a start and an end held beside
 * the original's metadata; the server's pipeline cuts, later.
 */
export function CharacterReplaceSettingsStep({
  project,
  config,
  pricing,
  onRetryQuote,
  onQuality,
  onTrim,
  onTrimClear,
}: {
  project: CharacterReplaceProject;
  /** The live price (Part 3, §12): it moves with the trim and the quality. */
  pricing: PricingState;
  onRetryQuote: () => void;
  config: CharacterReplacePublicConfig;
  onQuality: (quality: CharacterReplaceAnyQuality) => void;
  onTrim: (start: number, end: number) => void;
  onTrimClear: () => void;
}) {
  const groupId = useId();
  const video = project.video;
  const duration = originalDurationSeconds(project);
  const trim = project.settings.trim;
  const start = trim?.start ?? 0;
  const end = trim?.end ?? duration ?? 0;
  const selected = selectedDurationSeconds(project);
  const removed = trimmedSeconds(project);
  const fits = videoFits(project, config);
  const step = duration !== null && duration > 60 ? 0.5 : 0.1;
  const minKeep = config.trim.minimumSeconds;
  /*
    Part 6: the tiers are the MODE's. Full Character keeps 480p / 720p /
    1080p (with the source-resolution guidance from Part 2); Face Only and
    Skin + Face show Standard / High / Ultra. A tier the provider cannot
    honour is drawn disabled with its note — never hidden, never pretended.
  */
  const modeView = config.modes.find((m) => m.id === project.mode) ?? null;
  const tiers = modeView?.tiers ?? config.qualities.map((q) => ({ id: q.id, label: q.label, hint: q.hint, enabled: true, supported: true, note: null }));
  const maxSeconds = modeView?.maximumDurationSeconds ?? config.maximumDurationSeconds;
  const guidance = project.mode === "full_character" ? qualityGuidance(video?.metadata ?? null, project.settings.quality, config.qualities) : null;
  const chosenTier = tiers.find((t) => t.id === project.settings.quality) ?? null;
  /*
    Part 9 §7: cards a first-time user reads without knowing what a pixel is.
    The name is ours (Standard / HD / Full HD for the resolution tiers; the
    mode tiers already carry their names), the line under it is what it
    means for them, and ONE card wears "Recommended" — the mode's default
    tier, the one the operator marked as the balance of quality and cost.
  */
  const recommendedId = modeView?.defaultTier ?? (project.mode === "full_character" ? "720p" : null);
  const nameFor = (id: string, label: string) => (id === "480p" ? "Standard" : id === "720p" ? "HD" : id === "1080p" ? "Full HD" : label);
  const meaningFor = (id: string, hint: string) =>
    id === "480p" ? "Lower cost · faster · softer detail" : id === "720p" ? "Sharper detail · balanced cost" : id === "1080p" ? "Highest detail · slowest" : hint;

  /* ── the scrubbing preview ───────────────────────────────────────────── */
  const preview = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  /*
    Part 9 §6: play the KEPT range, not the file. Playback starts at the start
    handle and pauses itself at the end handle; the clock under the handles
    follows the playhead. The billed duration is untouched — it is the
    handles' range the quote already prices; this only lets the member watch
    what those handles keep.
  */
  const togglePlay = useCallback(() => {
    const el = preview.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (el.currentTime < start || el.currentTime >= end - 0.05) el.currentTime = start;
    void el.play().catch(() => null);
  }, [start, end]);
  const onTimeUpdate = useCallback(() => {
    const el = preview.current;
    if (!el) return;
    setNow(el.currentTime);
    if (!el.paused && el.currentTime >= end) {
      el.pause();
      el.currentTime = end;
    }
  }, [end]);
  const seekTo = useCallback((seconds: number) => {
    const el = preview.current;
    if (!el || !Number.isFinite(seconds)) return;
    try {
      el.pause();
      el.currentTime = Math.max(0, seconds);
      setNow(Math.max(0, seconds));
    } catch {
      /* a not-yet-seekable element; the next move will land */
    }
  }, []);
  // Land on the start of the kept range when the step opens.
  useEffect(() => {
    seekTo(start);
    // Only on mount: moving the handles seeks explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveStart = (value: number) => {
    const next = Math.min(value, end - minKeep);
    onTrim(next, end);
    seekTo(next);
  };
  const moveEnd = (value: number) => {
    const next = Math.max(value, start + minKeep);
    onTrim(start, next);
    seekTo(next);
  };

  return (
    <div className="space-y-6">
      {/* ── quality ─────────────────────────────────────────────────────── */}
      <section aria-labelledby={`${groupId}-quality`}>
        <h3 id={`${groupId}-quality`} className="text-[15px] font-bold tracking-[-0.01em]">
          Output quality
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {REPLACEMENT_MODE_COPY[project.mode].label} · higher quality takes longer to process and costs more per second.
        </p>
        <div role="radiogroup" aria-labelledby={`${groupId}-quality`} className="mt-3 grid grid-cols-3 gap-2">
          {tiers.map((q) => {
            const active = q.id === project.settings.quality;
            const offered = q.enabled && q.supported;
            const recommended = offered && q.id === recommendedId;
            return (
              <button
                key={q.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!offered}
                onClick={() => onQuality(q.id as CharacterReplaceAnyQuality)}
                title={!offered ? (q.note ?? "Not available right now") : undefined}
                className={cn(
                  "relative flex min-h-[84px] flex-col items-center justify-center rounded-2xl border px-2 pb-3 pt-4 transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  active
                    ? "border-foreground bg-foreground text-background shadow-[0_10px_24px_-16px_rgba(15,23,42,0.6)]"
                    : "border-border/70 bg-card text-foreground hover:border-foreground/30",
                )}
              >
                {recommended ? (
                  <span
                    className={cn(
                      "absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em]",
                      active ? "bg-background text-foreground" : "bg-gradient-to-r from-blue-600 to-fuchsia-500 text-white",
                    )}
                  >
                    Recommended
                  </span>
                ) : null}
                <span className="text-[15px] font-bold">{nameFor(q.id, q.label)}</span>
                <span className={cn("mt-0.5 text-[11px] font-semibold tabular-nums", active ? "text-background/80" : "text-muted-foreground")}>{q.label !== nameFor(q.id, q.label) ? q.label : "\u00a0"}</span>
                <span className={cn("mt-1 text-center text-[10.5px] font-medium leading-tight", active ? "text-background/70" : "text-muted-foreground")}>
                  {offered ? meaningFor(q.id, q.hint) : "Not available"}
                </span>
              </button>
            );
          })}
        </div>
        {/*
          What the tier actually does at the provider — the honest line
          (Face Only brief §4). 480p is a lower GENERATION, not a downscale:
          every result the owner found unclear on 2026-09-14 was a 480p run.
        */}
        {chosenTier?.note ? (
          <p role="status" className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
            {chosenTier.note}
          </p>
        ) : project.mode === "full_character" && project.settings.quality === "480p" ? (
          <p role="status" className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
            480p renders the whole video at a lower resolution — faces come out noticeably softer than 720p. Choose 720p for a clean result.
          </p>
        ) : null}
        {guidance ? (
          <p role="status" className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
            {guidance}
          </p>
        ) : null}
      </section>

      {/* ── trim ────────────────────────────────────────────────────────── */}
      {config.trim.enabled ? (
        <section aria-labelledby={`${groupId}-trim`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`${groupId}-trim`} className="text-[15px] font-bold tracking-[-0.01em]">
                Trim video
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Keep only the part you need. A shorter video processes faster and costs less.
              </p>
            </div>
            {trim ? (
              <button
                type="button"
                onClick={() => {
                  onTrimClear();
                  seekTo(0);
                }}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-primary transition hover:bg-primary/[0.06]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reset
              </button>
            ) : null}
          </div>

          {duration === null || !video ? (
            <p className="mt-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
              This video&apos;s length could not be read on your device, so it cannot be trimmed here. It will be
              measured when it is uploaded.
            </p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-[1.25rem] border border-border/70 bg-card">
              {/* the scrubbing preview: muted, never autoplays, one decoder */}
              <div className="relative bg-[#0b0f1a]">
                <video
                  ref={preview}
                  key={video.objectUrl}
                  src={video.objectUrl}
                  muted
                  playsInline
                  preload="metadata"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={onTimeUpdate}
                  onClick={togglePlay}
                  aria-label="Preview of the kept range"
                  className="mx-auto block max-h-[38vh] w-full cursor-pointer object-contain sm:max-h-[22rem]"
                />
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play the kept range"}
                  aria-pressed={playing}
                  className={cn(
                    "absolute bottom-3 left-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition",
                    "hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                  )}
                >
                  {playing ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="ml-0.5 h-5 w-5" aria-hidden />}
                </button>
                <span className="pointer-events-none absolute bottom-4 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white backdrop-blur-sm">
                  {formatClock(now ?? start)} / {formatClock(duration)}
                </span>
              </div>

              <div className="p-4">
                <dl className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Selected</dt>
                    <dd className={cn("mt-0.5 text-[17px] font-bold tabular-nums tracking-[-0.01em]", !fits && "text-rose-500")}>
                      {formatClock(start)} – {formatClock(end)}
                      <span className={cn("ml-2 text-[13px] font-semibold", !fits ? "text-rose-500" : "text-muted-foreground")}>{formatSeconds(selected)}</span>
                    </dd>
                  </div>
                  <div className="shrink-0 text-right">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Whole video</dt>
                    <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-muted-foreground">{formatSeconds(duration)}</dd>
                  </div>
                </dl>

                {/* the two handles over one track */}
                <div className="relative mt-4 h-11">
                  <div aria-hidden className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-secondary" />
                  <div
                    aria-hidden
                    className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500"
                    style={{ left: `${(start / duration) * 100}%`, right: `${100 - (end / duration) * 100}%` }}
                  />
                  {now !== null && now > start && now < end ? (
                    <div aria-hidden className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${(now / duration) * 100}%` }} />
                  ) : null}
                  <input
                    type="range"
                    aria-label="Start of the kept range, in seconds"
                    aria-valuetext={formatClock(start)}
                    min={0}
                    max={duration}
                    step={step}
                    value={start}
                    onChange={(e) => moveStart(Number(e.target.value))}
                    className="frenz-trim-range absolute inset-0 w-full"
                  />
                  <input
                    type="range"
                    aria-label="End of the kept range, in seconds"
                    aria-valuetext={formatClock(end)}
                    min={0}
                    max={duration}
                    step={step}
                    value={end}
                    onChange={(e) => moveEnd(Number(e.target.value))}
                    className="frenz-trim-range absolute inset-0 w-full"
                  />
                </div>

                {/* the clock: start — end, and the whole video's end for scale */}
                <div className="flex items-center justify-between text-[12px] font-semibold tabular-nums">
                  <span>{formatClock(start)}</span>
                  <span className="text-muted-foreground">—</span>
                  <span>{formatClock(end)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10.5px] font-medium tabular-nums text-muted-foreground/70">
                  <span>{formatClock(0)}</span>
                  <span>{formatClock(duration)}</span>
                </div>

                {!fits && selected !== null && selected > maxSeconds ? (
                  <p role="status" className="mt-3 text-[12.5px] font-semibold text-rose-500">
                    Keep {formatSeconds(maxSeconds)} or less to continue.
                  </p>
                ) : !fits && selected !== null && selected < minKeep ? (
                  <p role="status" className="mt-3 text-[12.5px] font-semibold text-rose-500">
                    Keep at least {formatSeconds(minKeep)}.
                  </p>
                ) : removed !== null && removed > 0.05 ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <Scissors className="h-3.5 w-3.5 text-primary/70" aria-hidden />
                    Trimmed by {formatSeconds(removed)} — less to process, and a lower cost.
                  </p>
                ) : duration > 3 ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <Scissors className="h-3.5 w-3.5 text-primary/70" aria-hidden />
                    Drag the handles to shorten the video and reduce processing cost.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* ── the live price (Part 3, §12; Part 6 §13): the server's figure for THESE settings ── */}
      {config.pricingAvailable ? (
        <VideoGenerationCostPreview compact project={project} config={config} pricing={pricing} symbol={config.symbol} onRetry={onRetryQuote} />
      ) : (
        <section aria-label="Estimated cost" className="rounded-[1.25rem] border border-dashed border-border bg-card/60 px-4 py-3.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Estimated cost</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            The exact price is calculated by Frenz AI before you confirm. Pricing isn&apos;t switched on yet, so nothing is charged.
          </p>
        </section>
      )}
    </div>
  );
}
