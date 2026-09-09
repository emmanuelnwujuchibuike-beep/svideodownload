/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT DETECTION — boxes from an OCR model, turned into a mask
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "if hjunior29 detector isn't good enough we should use a
 * better detector because I tried a different video and it gave a worst
 * result", then "fix the detector and wire it. Do this once and for all."
 *
 * ── 🔴 WHY THE OLD DETECTOR HAD TO GO, MEASURED RATHER THAN ASSUMED ─────────
 *
 * `hjunior29/video-text-remover` missed a burned-in caption at conf 0.25, 0.15
 * AND 0.08 — three thresholds, same miss, so a capability limit rather than a
 * tuning knob. On the owner's 1080x1920 clip it left "Bus" and 'S"' standing at
 * either end of a caption it had otherwise removed.
 *
 * `datalab-to/ocr` (Surya) was given the SAME frame and returned both, with
 * pixel-accurate boxes, in 13.4 seconds:
 *
 *     "Bus"  bbox [173, 1191, 313, 1298]
 *     'S"'   bbox [821, 1205, 904, 1275]
 *
 * That is the whole argument. It is a purpose-built text detector rather than a
 * remover with detection bolted on, it reports coordinates instead of painting
 * black rectangles we then have to reverse-engineer, and it reads low-contrast
 * text that the old model could not see at any threshold.
 *
 * ── 🔴 IT IS A PER-IMAGE MODEL, AND THAT SHAPES EVERYTHING HERE ─────────────
 *
 * Surya reads a picture, not a video. Running it on 273 frames is not an
 * option, so the worker samples a handful of frames across the clip and UNIONS
 * what comes back into one static mask.
 *
 * That is not a compromise made for cost — it is also the better mask:
 *
 *   · Social captions are static for long stretches, so a union of samples is
 *     very close to the true per-frame answer.
 *   · A mask that does not flicker is what a flow-based inpainter wants. A
 *     per-frame mask that gains and loses a few pixels between frames makes
 *     ProPainter's propagation disagree with itself, which is visible as a
 *     shimmer along the repaired edge.
 *   · A caption that appears at 0:04 gets repainted from 0:00 too. That costs
 *     nothing: the region has no text in those frames, so the inpainter is
 *     reconstructing background it can see perfectly in the same frame.
 *
 * Pure and dependency-free: parsing, merging and the filter string are all
 * testable without a network, a GPU or ffmpeg.
 */

/** A box in SOURCE pixel coordinates. */
export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One text line as Surya reports it. Deliberately loose — this is parsed from a
 * provider response, so every field is treated as possibly absent or wrong.
 */
interface SuryaLine {
  bbox?: unknown;
  polygon?: unknown;
  confidence?: unknown;
  text?: unknown;
}

/**
 * Read boxes out of one Surya response.
 *
 * ── 🔴 EVERY FIELD IS CHECKED, BECAUSE THIS DECIDES WHAT GETS PAINTED OVER ──
 *
 * A malformed number reaching the filter graph is a box in the wrong place, and
 * a box in the wrong place is a hole punched in somebody's video. A response
 * this function cannot understand yields NO boxes, and the caller treats "no
 * boxes" as "nothing to remove" rather than guessing.
 *
 * `minConfidence` is a floor, not a target: Surya is confident about real text
 * and hesitant about compression noise, so this mostly excludes the latter.
 */
export function parseSuryaBoxes(
  output: unknown,
  opts: { minConfidence?: number } = {},
): TextBox[] {
  const min = opts.minConfidence ?? 0.4;
  const pages = (output as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) return [];

  const boxes: TextBox[] = [];
  for (const page of pages) {
    const lines = (page as { text_lines?: unknown })?.text_lines;
    if (!Array.isArray(lines)) continue;
    for (const raw of lines as SuryaLine[]) {
      const confidence = typeof raw?.confidence === "number" ? raw.confidence : 1;
      if (confidence < min) continue;
      const box = lineToBox(raw);
      if (box) boxes.push(box);
    }
  }
  return boxes;
}

/**
 * A line's rectangle, from its `bbox` or, failing that, its polygon.
 *
 * 🔴 The POLYGON is preferred where both exist and disagree in size, because
 * Surya reports rotated text as a polygon whose axis-aligned `bbox` is the
 * tighter of the two only for horizontal lines. Taking the extent of the
 * polygon points is correct in both cases; taking `bbox` is correct in one.
 */
function lineToBox(line: SuryaLine): TextBox | null {
  const fromPolygon = polygonExtent(line.polygon);
  const fromBbox = bboxToBox(line.bbox);
  const box = fromPolygon ?? fromBbox;
  if (!box) return null;
  // A zero- or negative-sized box is not a box. It happens: Surya emits
  // placeholder chars with `bbox_valid: false` and a 1x1 extent.
  if (box.w < 2 || box.h < 2) return null;
  return box;
}

function bboxToBox(value: unknown): TextBox | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [x1, y1, x2, y2] = value.map((n) => Number(n));
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null;
  return {
    x: Math.min(x1!, x2!),
    y: Math.min(y1!, y2!),
    w: Math.abs(x2! - x1!),
    h: Math.abs(y2! - y1!),
  };
}

function polygonExtent(value: unknown): TextBox | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  if (xs.length < 3) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Grow every box by a margin, clamp it to the frame, and merge what overlaps.
 *
 * ── 🔴 THE MARGIN IS NOT DECORATION ─────────────────────────────────────────
 *
 * An OCR box hugs the glyphs. A caption's readability comes from what is
 * AROUND the glyphs — a drop shadow, a dark outline, a semi-transparent pill —
 * and none of that is inside the box. Repainting the letters and leaving their
 * shadow produces a ghost of the caption, which reads as a smudge rather than
 * as a clean removal.
 *
 * The margin is a FRACTION of the box's own height rather than a pixel count,
 * so it scales with the text: a 1080p caption and a 480p one both get a
 * proportionate skirt. Growing a temporal inpainter's region costs almost
 * nothing — it has other frames to borrow from — which is exactly the trade the
 * old classical fill could not make.
 *
 * ── And why merging matters ─────────────────────────────────────────────────
 *
 * Two words of one sentence arrive as two boxes with a gap between them. Left
 * separate, the inpainter repaints two patches and leaves a strip of untouched
 * background between them that still carries the caption's shadow. Merging
 * overlapping boxes after the margin is applied turns a line of words back into
 * a line.
 */
export function mergeBoxes(
  boxes: readonly TextBox[],
  frame: { width: number; height: number },
  opts: { marginRatio?: number; minMargin?: number } = {},
): TextBox[] {
  const marginRatio = opts.marginRatio ?? 0.35;
  const minMargin = opts.minMargin ?? 4;

  const grown = boxes
    .map((b) => {
      const margin = Math.max(minMargin, Math.round(b.h * marginRatio));
      const x = Math.max(0, Math.round(b.x - margin));
      const y = Math.max(0, Math.round(b.y - margin));
      const right = Math.min(frame.width, Math.round(b.x + b.w + margin));
      const bottom = Math.min(frame.height, Math.round(b.y + b.h + margin));
      return { x, y, w: right - x, h: bottom - y };
    })
    .filter((b) => b.w > 0 && b.h > 0);

  /*
    Repeated passes until nothing merges. One pass is not enough: A may not
    overlap C, but after A absorbs B the union can. A caption of five words
    collapses to one box only if merging is run to a fixed point.
  */
  const out: TextBox[] = [];
  for (const box of grown) {
    let current = box;
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (overlaps(current, out[i]!)) {
          current = union(current, out.splice(i, 1)[0]!);
          merged = true;
        }
      }
    }
    out.push(current);
  }
  return out;
}

function overlaps(a: TextBox, b: TextBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function union(a: TextBox, b: TextBox): TextBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * How much of the frame the boxes cover, 0-1.
 *
 * 🔴 Approximate by construction: overlapping boxes are counted twice, so this
 * can exceed the true fraction. That is the safe direction — the caller uses it
 * only to REFUSE an implausibly large mask, and over-reporting means it refuses
 * slightly sooner rather than shipping a frame that has been almost entirely
 * invented. `mergeBoxes` runs first anyway, so overlaps are rare by the time
 * this sees them.
 */
export function boxCoverage(boxes: readonly TextBox[], frame: { width: number; height: number }): number {
  const area = frame.width * frame.height;
  if (area <= 0) return 0;
  const covered = boxes.reduce((sum, b) => sum + b.w * b.h, 0);
  return Math.min(1, covered / area);
}

/**
 * The ffmpeg arguments that turn a list of boxes into a mask video.
 *
 * ── 🔴 A GENERATED SOURCE, NOT A FILTER OVER THE VIDEO ──────────────────────
 *
 * The mask is white boxes on black at the source's size and frame rate, and
 * nothing about it depends on the source's PIXELS — only on its dimensions,
 * rate and duration. So it is drawn from `color=black` rather than by filtering
 * the video, which means ffmpeg never decodes a single frame of the member's
 * file to produce it. On a 273-frame 1080p clip that is the difference between
 * a pass that takes seconds and one that takes a fraction of one.
 *
 * ⚠️ LOSSLESS (`-qp 0`), like every mask this codebase builds. A lossy encode
 * softens the box edges into a grey ramp, and both ProPainter and the
 * `maskedmerge` composite treat grey as a partial blend — which is a ghost of
 * the caption showing through the repair.
 */
export function buildBoxMaskArgs(plan: {
  boxes: readonly TextBox[];
  outPath: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
}): string[] {
  /*
    `drawbox` per box, filled white. `t=fill` rather than a thickness, because
    a mask is a solid region — an outlined box would ask the inpainter to
    repaint a frame around the text and leave the text itself.
  */
  const chain = plan.boxes
    .map((b) => `drawbox=x=${Math.round(b.x)}:y=${Math.round(b.y)}:w=${Math.round(b.w)}:h=${Math.round(b.h)}:color=white@1:t=fill`)
    .join(",");

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${plan.width}x${plan.height}:r=${plan.fps}:d=${Math.max(0.1, plan.durationSeconds).toFixed(3)}`,
    // A mask with no boxes is a legitimate, entirely black video. The caller
    // decides what to do about it; this does not invent a box to avoid it.
    "-vf",
    chain ? `${chain},format=yuv420p` : "format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-qp",
    "0",
    "-r",
    String(plan.fps),
    plan.outPath,
  ];
}

/**
 * Which timestamps to sample.
 *
 * 🔴 Evenly spaced across the INTERIOR, never the first or last frame. Social
 * video opens on a fade, a logo card or black far more often than on its
 * caption, and ends the same way — so both endpoints are the frames least
 * likely to carry the text we are looking for, and each one spent there is a
 * provider call that learns nothing.
 *
 * The count is capped rather than proportional to length: a caption that
 * appears in a ten-minute video appears in one of eight evenly spaced samples
 * about as reliably as in one of eighty, and eighty calls is a bill.
 */
export function sampleTimestamps(durationSeconds: number, count: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  const n = Math.max(1, Math.min(16, Math.floor(count)));
  if (n === 1) return [durationSeconds / 2];
  // Interior points: 1/(n+1) … n/(n+1) of the clip.
  return Array.from({ length: n }, (_, i) => (durationSeconds * (i + 1)) / (n + 1));
}
