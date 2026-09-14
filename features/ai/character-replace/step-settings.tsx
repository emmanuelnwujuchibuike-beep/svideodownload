"use client";

import { Info, RotateCcw, Scissors } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";

import { CharacterReplaceInputSummary } from "@/features/ai/character-replace/input-summary";
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

  /* ── the scrubbing preview ───────────────────────────────────────────── */
  const preview = useRef<HTMLVideoElement>(null);
  const seekTo = useCallback((seconds: number) => {
    const el = preview.current;
    if (!el || !Number.isFinite(seconds)) return;
    try {
      el.pause();
      el.currentTime = Math.max(0, seconds);
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
                  "flex min-h-[64px] flex-col items-center justify-center rounded-2xl border px-2 py-3 transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  active
                    ? "border-foreground bg-foreground text-background shadow-[0_10px_24px_-16px_rgba(15,23,42,0.6)]"
                    : "border-border/70 bg-card text-foreground hover:border-foreground/30",
                )}
              >
                <span className="text-[15px] font-bold tabular-nums">{q.label}</span>
                <span className={cn("mt-0.5 text-center text-[11px] font-medium leading-tight", active ? "text-background/70" : "text-muted-foreground")}>
                  {offered ? q.hint : "Not available"}
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
              <div className="bg-[#0b0f1a]">
                <video
                  ref={preview}
                  key={video.objectUrl}
                  src={video.objectUrl}
                  muted
                  playsInline
                  preload="metadata"
                  aria-label="Preview of the frame at the selected point"
                  className="mx-auto block max-h-[38vh] w-full object-contain sm:max-h-[22rem]"
                />
              </div>

              <div className="p-4">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Original duration</dt>
                    <dd className="mt-0.5 text-[17px] font-bold tabular-nums tracking-[-0.01em]">{formatSeconds(duration)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Selected duration</dt>
                    <dd className={cn("mt-0.5 text-[17px] font-bold tabular-nums tracking-[-0.01em]", !fits && "text-rose-500")}>
                      {formatSeconds(selected)}
                    </dd>
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

      {/* ── the input summary (§15), with the output line that now means something ── */}
      <CharacterReplaceInputSummary project={project} config={config} />

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
