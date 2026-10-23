/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FROM DETECTOR BOXES TO "WHO IS IN THIS VIDEO" — pure
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The worker runs the existing YOLOX-nano person detector
 * (server/preflight/detectors.ts) on a few frames of the member's clip. This
 * file turns what it saw into the list the member taps on, and parses the
 * ffprobe answer the facts come from. No model, no ffmpeg, no storage — so
 * every rule is asserted in people-detect.test.ts.
 */

import type { DetectedPerson } from "@/lib/ai/kling/features/person-replace-prompt";
import type { KlingVideoFacts } from "@/lib/ai/kling/features/shared";
import type { PersonDetection } from "@/lib/ai/preflight/measure";

/** Where in the clip the people are looked for: early, middle, late. */
export const PEOPLE_SAMPLE_POSITIONS = [0.12, 0.5, 0.88] as const;

export const PEOPLE_DETECTION = {
  /** Below this the detector is guessing; a box nobody can see is not a person to pick. */
  minScore: 0.45,
  /** Smaller than this fraction of the frame height is a speck in the background — not tappable, not describable. */
  minHeightFrac: 0.08,
  /** The most people returned; more is a crowd the prompt cannot address (the handler refuses above 8). */
  maxPeople: 12,
} as const;

/* ─────────────────────────────── ffprobe ─────────────────────────────────── */

export interface ProbedVideo {
  facts: Omit<KlingVideoFacts, "sizeBytes">;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number | string }[];
}

/** "30000/1001" → 29.97. Null for "0/0" or junk. */
export function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const [n, d] = raw.split("/").map(Number);
  const fps = d ? n! / d : Number(raw);
  return Number.isFinite(fps) && fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : null;
}

/**
 * The video as it is DISPLAYED.
 *
 * 🔴 A phone records a portrait clip as 1920×1080 pixels plus a rotation tag,
 * and ffmpeg decodes it rotated. Reporting the coded size would put every
 * person box on its side, and mis-describe the shape to the limits check.
 * A ±90° rotation swaps width and height.
 */
export function parseFfprobe(json: unknown): ProbedVideo | null {
  const j = json as { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } } | null;
  const streams = Array.isArray(j?.streams) ? j!.streams! : [];
  const video = streams.find((s) => s.codec_type === "video" && (s.width ?? 0) > 0 && (s.height ?? 0) > 0);
  if (!video) return null;
  const rotation = Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const duration = Number(j?.format?.duration);
  return {
    facts: {
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0,
      width: quarter ? video.height! : video.width!,
      height: quarter ? video.width! : video.height!,
      fps: parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate),
      container: typeof j?.format?.format_name === "string" ? j.format.format_name : null,
    },
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

/* ─────────────────────────────── people ──────────────────────────────────── */

/** One sampled frame, as the detector saw it. */
export interface SampledFrame {
  /** Where in the clip, in ms. */
  positionMs: number;
  width: number;
  height: number;
  people: readonly PersonDetection[];
}

/** The confident, visible people on one frame, as boxes in fractions of the frame, left to right, ids p1…pN. */
export function normalizePeople(frame: SampledFrame): DetectedPerson[] {
  const { width: W, height: H } = frame;
  if (!(W > 0 && H > 0)) return [];
  const kept = frame.people
    .filter((p) => p.score >= PEOPLE_DETECTION.minScore)
    .map((p) => {
      // clip to the frame: the detector's box may run off an edge (a body cut by the bottom)
      const x0 = Math.max(0, p.box.x);
      const y0 = Math.max(0, p.box.y);
      const x1 = Math.min(W, p.box.x + p.box.w);
      const y1 = Math.min(H, p.box.y + p.box.h);
      return { score: p.score, box: { x: x0 / W, y: y0 / H, w: Math.max(0, x1 - x0) / W, h: Math.max(0, y1 - y0) / H } };
    })
    .filter((p) => p.box.w > 0.005 && p.box.h >= PEOPLE_DETECTION.minHeightFrac)
    // the biggest first when there are too many — the people a member is likely to mean
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .slice(0, PEOPLE_DETECTION.maxPeople)
    .sort((a, b) => a.box.x + a.box.w / 2 - (b.box.x + b.box.w / 2));
  const r = (n: number) => Math.round(n * 10_000) / 10_000;
  return kept.map((p, i) => ({ id: `p${i + 1}`, score: r(p.score), box: { x: r(p.box.x), y: r(p.box.y), w: r(p.box.w), h: r(p.box.h) } }));
}

/**
 * The frame the member picks on: the one where the MOST people are visible
 * (nobody can be picked who is not on it), the earliest on a tie — the
 * position words read most naturally from the start of the clip.
 */
export function chooseInspectionFrame(frames: readonly SampledFrame[]): { frame: SampledFrame; people: DetectedPerson[] } | null {
  let best: { frame: SampledFrame; people: DetectedPerson[] } | null = null;
  for (const frame of [...frames].sort((a, b) => a.positionMs - b.positionMs)) {
    const people = normalizePeople(frame);
    if (!best || people.length > best.people.length) best = { frame, people };
  }
  return best;
}

/**
 * Do the same number of people appear throughout? A clip where people walk in
 * or out makes "the second from the left" mean different people at different
 * moments — the member is told so, not refused.
 */
export function peopleCountsVary(frames: readonly SampledFrame[]): boolean {
  const counts = new Set(frames.map((f) => normalizePeople(f).length));
  return counts.size > 1;
}
