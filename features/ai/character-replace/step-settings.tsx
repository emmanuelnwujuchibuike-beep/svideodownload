"use client";

import { Scissors } from "lucide-react";
import { useId } from "react";

import type { CharacterReplacePublicConfig, CharacterReplaceQualityId } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceProject } from "@/lib/ai/character-replace/types";
import { formatSeconds, selectedDurationSeconds, trimmedSeconds, videoFits } from "@/lib/ai/character-replace/workspace";
import { cn } from "@/lib/utils";

/**
 * Step 3 — output settings.
 *
 * ── Quality: a segmented control, drawn from the server's list ──────────────
 *
 * §7: "The actual availability of these options should eventually come from
 * backend/admin configuration." It does now: the buttons are whatever
 * `config.qualities` contains, in its order, with its labels and hints. A
 * tier the operator switches off is simply not here.
 *
 * ── Trim: the foundation, with real arithmetic and no price ─────────────────
 *
 * Two range inputs — keyboard-operable, thumb-sized on a phone — choose the
 * kept range over the source. "Original duration" and "Selected duration"
 * are computed from them, which is honest arithmetic, not a price. What the
 * trim WOULD save in money is the pricing engine's to say (§10) and the
 * summary card marks that pending. What this step can say on its own is the
 * fact it holds: how many seconds the member's trim has removed.
 */
export function CharacterReplaceSettingsStep({
  project,
  config,
  onQuality,
  onTrim,
  onTrimClear,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig;
  onQuality: (quality: CharacterReplaceQualityId) => void;
  onTrim: (start: number, end: number) => void;
  onTrimClear: () => void;
}) {
  const groupId = useId();
  const video = project.video;
  const duration = video?.durationSeconds ?? null;
  const trim = project.settings.trim;
  const start = trim?.start ?? 0;
  const end = trim?.end ?? duration ?? 0;
  const selected = selectedDurationSeconds(project);
  const removed = trimmedSeconds(project);
  const fits = videoFits(project, config);
  const step = duration !== null && duration > 60 ? 0.5 : 0.1;

  return (
    <div className="space-y-6">
      {/* ── quality ─────────────────────────────────────────────────────── */}
      <section aria-labelledby={`${groupId}-quality`}>
        <h3 id={`${groupId}-quality`} className="text-[15px] font-bold tracking-[-0.01em]">
          Output quality
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Higher quality takes longer to process and costs more per second.
        </p>
        <div role="radiogroup" aria-labelledby={`${groupId}-quality`} className="mt-3 grid grid-cols-3 gap-2">
          {config.qualities.map((q) => {
            const active = q.id === project.settings.quality;
            return (
              <button
                key={q.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onQuality(q.id)}
                className={cn(
                  "flex min-h-[64px] flex-col items-center justify-center rounded-2xl border px-2 py-3 transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-foreground bg-foreground text-background shadow-[0_10px_24px_-16px_rgba(15,23,42,0.6)]"
                    : "border-border/70 bg-card text-foreground hover:border-foreground/30",
                )}
              >
                <span className="text-[15px] font-bold tabular-nums">{q.label}</span>
                <span className={cn("mt-0.5 text-[11px] font-medium", active ? "text-background/70" : "text-muted-foreground")}>
                  {q.hint}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── trim ────────────────────────────────────────────────────────── */}
      {config.trim.enabled ? (
        <section aria-labelledby={`${groupId}-trim`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`${groupId}-trim`} className="text-[15px] font-bold tracking-[-0.01em]">
                Trim
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Keep only the part you need. A shorter video processes faster and costs less.
              </p>
            </div>
            {trim ? (
              <button
                type="button"
                onClick={onTrimClear}
                className="shrink-0 rounded-full px-3 py-2 text-[12.5px] font-semibold text-primary transition hover:bg-primary/[0.06]"
              >
                Keep all
              </button>
            ) : null}
          </div>

          {duration === null ? (
            <p className="mt-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
              This video&apos;s length could not be read on your device, so it cannot be trimmed here. It will be
              measured when it is uploaded.
            </p>
          ) : (
            <div className="mt-3 rounded-[1.25rem] border border-border/70 bg-card p-4">
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
                  min={0}
                  max={duration}
                  step={step}
                  value={start}
                  onChange={(e) => onTrim(Math.min(Number(e.target.value), end - config.trim.minimumSeconds), end)}
                  className="frenz-trim-range absolute inset-0 w-full"
                />
                <input
                  type="range"
                  aria-label="End of the kept range, in seconds"
                  min={0}
                  max={duration}
                  step={step}
                  value={end}
                  onChange={(e) => onTrim(start, Math.max(Number(e.target.value), start + config.trim.minimumSeconds))}
                  className="frenz-trim-range absolute inset-0 w-full"
                />
              </div>
              <div className="flex items-center justify-between text-[11.5px] font-medium tabular-nums text-muted-foreground">
                <span>{formatSeconds(start)}</span>
                <span>{formatSeconds(end)}</span>
              </div>

              {!fits && selected !== null && selected > config.maximumDurationSeconds ? (
                <p role="status" className="mt-3 text-[12.5px] font-semibold text-rose-500">
                  Keep {formatSeconds(config.maximumDurationSeconds)} or less to continue.
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
          )}
        </section>
      ) : null}

      {/* ── the price area, as a placeholder ─────────────────────────────── */}
      <section aria-label="Estimated cost" className="rounded-[1.25rem] border border-dashed border-border bg-card/60 px-4 py-3.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Estimated cost</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {config.pricingAvailable
            ? "Calculated on the next step from these settings."
            : "The exact price is calculated by Frenz AI before you confirm. Pricing isn't switched on yet, so nothing is charged."}
        </p>
      </section>
    </div>
  );
}
