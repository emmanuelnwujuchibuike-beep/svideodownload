import { encodeQr, type QrMatrix } from "@/lib/qr/encode";

/**
 * QR matrix → SVG path data.
 *
 * ── One path, not N rects ────────────────────────────────────────────────
 * A version-5 code is 37×37 = 1369 modules. Emitting a `<rect>` per dark
 * module means ~700 DOM nodes for one picture, which is a measurable layout
 * and memory cost on a phone for something that never changes. Every dark
 * module becomes a subpath of a SINGLE `<path>` instead: one node, one paint,
 * and it stays a vector so it is sharp at any size and prints properly.
 *
 * ── The quiet zone is not optional ───────────────────────────────────────
 * The spec requires four modules of clear margin. Scanners genuinely fail
 * without it, and it is the single most common reason a hand-made QR "looks
 * fine but won't scan" — so it is baked into the viewBox rather than left to
 * whoever writes the surrounding CSS.
 *
 * Pure: returns strings. No React, no DOM, no I/O.
 */

export const QUIET_ZONE = 4;

/** The `d` attribute for one path covering every dark module. */
export function matrixPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r += 1) {
    const row = matrix.modules[r]!;
    let c = 0;
    while (c < matrix.size) {
      if (!row[c]) {
        c += 1;
        continue;
      }
      // Merge horizontally adjacent modules into one rectangle — fewer, larger
      // subpaths for the same picture.
      let run = 1;
      while (c + run < matrix.size && row[c + run]) run += 1;
      parts.push(`M${c + QUIET_ZONE} ${r + QUIET_ZONE}h${run}v1h-${run}z`);
      c += run;
    }
  }
  return parts.join("");
}

export interface QrSvgOptions {
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Dark module colour. Defaults to `currentColor` so it inherits. */
  color?: string;
  /** Background. `null` renders transparent. */
  background?: string | null;
  /** Accessible label. Empty string marks it decorative. */
  title?: string;
}

export interface QrSvg {
  /** viewBox dimension (modules + both quiet zones). */
  extent: number;
  path: string;
  version: number;
  /** The complete markup, ready to render. */
  markup: string;
}

/**
 * Build the full SVG for `text`.
 *
 * Returns the parts as well as the markup so a React caller can render a real
 * `<svg>` element with a `<path>` child rather than using
 * `dangerouslySetInnerHTML` — which is the difference between a component and
 * an injection surface, even when the input is our own URL.
 */
export function qrSvg(text: string, options: QrSvgOptions = {}): QrSvg {
  const matrix = encodeQr(text);
  const extent = matrix.size + QUIET_ZONE * 2;
  const path = matrixPath(matrix);
  const size = options.size ?? 240;
  const color = options.color ?? "currentColor";
  const background = options.background === undefined ? "#ffffff" : options.background;
  const title = options.title ?? "";

  const bg = background ? `<rect width="${extent}" height="${extent}" fill="${background}"/>` : "";
  const label = title
    ? `role="img" aria-label="${title.replace(/"/g, "&quot;")}"`
    : 'role="presentation" aria-hidden="true"';

  return {
    extent,
    path,
    version: matrix.version,
    markup:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges" ${label}>` +
      `${bg}<path d="${path}" fill="${color}"/></svg>`,
  };
}
