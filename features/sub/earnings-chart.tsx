"use client";

import { useState } from "react";

import { usd } from "@/lib/creator/membership/engine";

/**
 * Daily net earnings as bars (Frenz Exclusive Part 7) — plain SVG, no chart library, no animation.
 * The bars are decoration for what the summary line and the screen-reader table say in words:
 * colour is never the only signal (a day with a net refund is drawn BELOW the baseline and listed
 * as negative). Theme colours come from the tokens (currentColor + text-primary / text-rose-600 dark:text-rose-400).
 */
export interface DailyPoint {
  day: string;
  netCents: number;
  newSubs: number;
  renewals: number;
}

const W = 600;
const H = 140;
const PAD = 6;

const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

export function EarningsChart({ points, days }: { points: DailyPoint[]; days: number }) {
  // step 21 (design/Earnings.dc.html): "Tap a bar for that day" — the chosen day's figures replace the summary line
  const [picked, setPicked] = useState<DailyPoint | null>(null);
  const max = Math.max(1, ...points.map((p) => Math.abs(p.netCents)));
  const hasNeg = points.some((p) => p.netCents < 0);
  const base = hasNeg ? H / 2 : H - PAD;
  const scale = (hasNeg ? H / 2 - PAD : H - PAD * 2) / max;
  const bw = W / Math.max(1, points.length);
  const total = points.reduce((t, p) => t + p.netCents, 0);
  const best = points.reduce<DailyPoint | null>((b, p) => (p.netCents > 0 && (!b || p.netCents > b.netCents) ? p : b), null);
  const activeDays = points.filter((p) => p.netCents !== 0).length;
  const summary = activeDays
    ? `${usd(Math.abs(total))} ${total < 0 ? "net refunded" : "net earned"} over ${days} days, on ${activeDays} day${activeDays === 1 ? "" : "s"}.${best ? ` Best day: ${short(best.day)}, ${usd(best.netCents)}.` : ""}`
    : `No earnings in the last ${days} days.`;

  return (
    <figure className="m-0">
      <figcaption className="mb-3 min-h-[2.5em] text-[12.5px] leading-snug text-frenz-muted" aria-live="polite">
        {picked ? `${short(picked.day)}: ${picked.netCents < 0 ? "−" : ""}${usd(Math.abs(picked.netCents))} · ${picked.newSubs} new · ${picked.renewals} renewed` : summary}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={summary} className="block h-28 w-full">
        <line x1={0} x2={W} y1={base} y2={base} className="stroke-black/[0.08] dark:stroke-white/[0.12]" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
        {points.map((p, i) => {
          if (!p.netCents) return null;
          const h = Math.max(2, Math.abs(p.netCents) * scale);
          const x = i * bw + bw * 0.18;
          return <rect key={p.day} x={x} width={Math.max(1, bw * 0.64)} y={p.netCents > 0 ? base - h : base} height={h} rx={Math.min(3, bw * 0.3)} className={p.netCents > 0 ? "fill-frenz-violet" : "fill-rose-500"} opacity={picked && picked.day !== p.day ? 0.35 : p.netCents > 0 ? 0.9 : 0.7} />;
        })}
        {/* a full-height tap target per day (the bars themselves can be 2 px), so any day can be read */}
        {points.map((p, i) => (
          <rect key={`hit-${p.day}`} x={i * bw} width={bw} y={0} height={H} fill="transparent" className="cursor-pointer" onClick={() => setPicked((cur) => (cur?.day === p.day ? null : p))} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        <span>{points[0] ? short(points[0].day) : ""}</span>
        <span>{points.length ? short(points[points.length - 1]!.day) : ""}</span>
      </div>
      {/* Wrapped, not `table.sr-only`: a table ignores the 1px width and grew the page sideways (found at 320px) */}
      <div className="sr-only">
      <table>
        <caption>Net earnings per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Net earnings</th>
            <th scope="col">New subscribers</th>
            <th scope="col">Renewals</th>
          </tr>
        </thead>
        <tbody>
          {points
            .filter((p) => p.netCents || p.newSubs || p.renewals)
            .map((p) => (
              <tr key={p.day}>
                <td>{short(p.day)}</td>
                <td>{p.netCents < 0 ? `minus ${usd(-p.netCents)}` : usd(p.netCents)}</td>
                <td>{p.newSubs}</td>
                <td>{p.renewals}</td>
              </tr>
            ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
