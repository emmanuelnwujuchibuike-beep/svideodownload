import type { RetentionCurve } from "@/lib/creator/retention";
import { MIN_DROPOFF_SAMPLE, retentionPath } from "@/lib/creator/retention";

import { EmptyNote } from "./studio-ui";

/**
 * The retention curve (Feature 15 · Part 9).
 *
 * A server component drawing inline SVG — no chart library, no client
 * JavaScript. The geometry comes from `retentionPath`, which is unit-tested, so
 * this file is a renderer and nothing else.
 *
 * ── The caveat is ON THE CHART, not in a doc ────────────────────────────
 * `watch_ms` is the playhead position when playback paused or ended, so a
 * viewer who seeks backwards before leaving is recorded at the lower position
 * and a looping rewatch arrives as a second sample. That makes this a real
 * distribution of real playhead positions and NOT frame-accurate attention
 * telemetry. A creator making decisions from this chart is entitled to know
 * which of those two it is, so the note ships with the picture.
 */

const W = 320;
const H = 120;

export function RetentionChart({ curve }: { curve: RetentionCurve }) {
  if (curve.points.length === 0) {
    return (
      <EmptyNote>
        No watch data for this post yet. The curve appears once people have actually watched it — it is
        never drawn from an estimate.
      </EmptyNote>
    );
  }

  const line = retentionPath(curve, W, H);
  // Close the path along the baseline for the fill.
  const area = `${line} L${W},${H} L0,${H} Z`;
  const dropX = curve.dropOff ? curve.dropOff.at * W : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-32 w-full min-w-[280px]"
          role="img"
          aria-label={`Retention curve: ${Math.round(curve.averageCompletion * 100)}% average watch-through across ${curve.sampleSize} watches`}
        >
          <defs>
            <linearGradient id="retention-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.28" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Quarter gridlines — enough to read a value, few enough to ignore. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              y1={H * f}
              x2={W}
              y2={H * f}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          ))}

          <path d={area} fill="url(#retention-fill)" />
          <path d={line} className="stroke-primary" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />

          {dropX !== null ? (
            <>
              <line x1={dropX} y1={0} x2={dropX} y2={H} className="stroke-rose-500" strokeWidth={1.5} strokeDasharray="4 3" />
              <circle cx={dropX} cy={H - (curve.points.find((p) => p.at === curve.dropOff!.at)?.reached ?? 0) * H} r={4} className="fill-rose-500" />
            </>
          ) : null}
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>Start</span>
        <span>Halfway</span>
        <span>End</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <Stat label="Average watched" value={`${Math.round(curve.averageCompletion * 100)}%`} />
        <Stat label="Finished it" value={`${Math.round(curve.completionRate * 100)}%`} />
        <Stat label="Watches" value={curve.sampleSize.toLocaleString()} />
      </div>

      {curve.dropOff ? (
        <p className="mt-3 rounded-xl bg-rose-500/[0.07] px-3 py-2.5 text-xs leading-relaxed">
          <span className="font-semibold text-rose-600 dark:text-rose-400">
            Biggest drop-off at {Math.round(curve.dropOff.at * 100)}%
          </span>{" "}
          — {Math.round(curve.dropOff.lost * 100)}% of viewers left in that tenth of the video.
        </p>
      ) : curve.sampleSize < MIN_DROPOFF_SAMPLE ? (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          A drop-off point needs at least {MIN_DROPOFF_SAMPLE} watches before it means anything — this post
          has {curve.sampleSize}. No point is claimed until then.
        </p>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/85">
        Measured from the playhead position when each watch ended. Someone who skips backwards before
        leaving counts at the lower position, and a rewatch counts as a separate watch.
        {curve.unusable > 0 ? ` ${curve.unusable} watches had no duration reported and are excluded.` : ""}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
