"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { EmptyNote } from "./studio-ui";

/**
 * The hour-of-day watch histogram (Feature 15 · Part 9).
 *
 * The most actionable audience fact this product can honestly produce, and the
 * input to the assistant's upload-time suggestion. Every bar is a count of real
 * `post_watch_events.created_at` timestamps — nothing here is modelled.
 *
 * ── Why this is a client component ──────────────────────────────────────
 * The server buckets in UTC, because the server has no idea where the creator
 * is. Rendering UTC counts under a "your local hours" label would be exactly
 * the defect this Part keeps calling out: a label that does not match the query
 * underneath it. Bucketing by hour makes the conversion a ROTATION, so the
 * browser — which does know the offset — rotates the array and the label
 * becomes true.
 *
 * ⚠️ Whole hours. A :30 or :45 offset (India, Nepal, parts of Australia) lands
 * in the nearer hour, and the note says so rather than quietly rounding.
 */

function hourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

export function ViewingHours({ buckets, peak }: { buckets: number[]; peak: number | null }) {
  /*
    Starts at 0 so the server and the first client paint agree — a hydration
    mismatch here would be a chart that visibly jumps. The real offset is
    applied in an effect, after mount.
  */
  const [offsetHours, setOffsetHours] = useState(0);
  const [halfHourZone, setHalfHourZone] = useState(false);

  useEffect(() => {
    const minutes = -new Date().getTimezoneOffset();
    setOffsetHours(Math.round(minutes / 60));
    setHalfHourZone(minutes % 60 !== 0);
  }, []);

  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <EmptyNote>
        No watch history yet. This fills in as people watch your posts, and it is the one signal that can
        tell you when to publish.
      </EmptyNote>
    );
  }

  // Rotate UTC → local. A watch recorded at UTC hour h happened at local hour
  // h + offset, so local bucket i takes the count from UTC bucket i - offset.
  const local = Array.from({ length: 24 }, (_, i) => buckets[(((i - offsetHours) % 24) + 24) % 24] ?? 0);
  const localPeak = peak === null ? null : (((peak + offsetHours) % 24) + 24) % 24;
  const max = Math.max(...local, 1);

  return (
    <div>
      <div
        className="flex items-end gap-[3px]"
        role="img"
        aria-label={`Watches by hour of day. Busiest hour: ${localPeak !== null ? hourLabel(localPeak) : "none"}.`}
      >
        {local.map((count, h) => (
          <div key={h} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                "w-full rounded-t-[3px] transition-[height] duration-500 ease-out motion-reduce:transition-none",
                h === localPeak ? "bg-primary" : "bg-primary/25",
              )}
              style={{ height: `${Math.max(2, (count / max) * 72)}px` }}
              title={`${hourLabel(h)} — ${count} ${count === 1 ? "watch" : "watches"}`}
            />
            {/* Every third hour, so the axis stays readable on a phone. */}
            <span className="text-[9px] leading-none text-muted-foreground">{h % 3 === 0 ? h : ""}</span>
          </div>
        ))}
      </div>

      {localPeak !== null ? (
        <p className="mt-3 rounded-xl bg-primary/[0.06] px-3 py-2.5 text-xs leading-relaxed">
          Your audience is most active around{" "}
          <span className="font-semibold text-primary">{hourLabel(localPeak)}</span> — {local[localPeak]} of{" "}
          {total.toLocaleString()} watches in the last 90 days landed in that hour.
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Shown in this device&apos;s timezone.
        {halfHourZone ? " Your timezone is offset by part of an hour, so bars land in the nearer hour." : ""}
      </p>
    </div>
  );
}
