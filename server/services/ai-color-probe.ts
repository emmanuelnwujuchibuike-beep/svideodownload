import { execFile } from "node:child_process";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT A FILE SAYS ABOUT ITS OWN COLOUR — one probe for prepare and finalize
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14: "it gives it extra color more than the original video,
 * it supposed to stay natural" — and, the same day, the Video Ready brief:
 * "Understand exactly where the current excessive saturation/color treatment
 * is coming from. Do not blindly add another filter. Fix the underlying
 * cause."
 *
 * The audit (see ai-character-replace-finalize-service.ts, THE COLOUR
 * AUDIT) found two causes, both about SIGNALLING rather than pixels:
 *
 *   1. An HDR phone source (HLG or PQ transfer, BT.2020 primaries, 10-bit)
 *      converted to 8-bit SDR without tone-mapping. Every colour reads hotter
 *      and highlights clip. Detected here, fixed in PREPARE by a real
 *      tone-map (lib/ai/character-replace/ffmpeg.ts).
 *   2. The model's output carries NO colour tags. A player then guesses — and
 *      for a 480p-class file the common guess is BT.601, which shifts reds
 *      and greens and reads as "more colour" against a BT.709-tagged source.
 *      Fixed in FINALIZE by writing the tags into the stream WITHOUT
 *      re-encoding (an H.264/HEVC metadata bitstream filter, `-c copy`).
 *
 * Nothing measures saturation and nothing turns it down: a replaced
 * character in a brighter shirt is not a colour cast, and a global pull
 * would make the master less accurate, not more.
 */
export interface ColorSignal {
  codec: string | null;
  transfer: string | null;
  primaries: string | null;
  matrix: string | null;
  range: string | null;
  pixFmt: string | null;
}

export function isHdrSource(c: ColorSignal | null): boolean {
  if (!c) return false;
  const t = (c.transfer ?? "").toLowerCase();
  const p = (c.primaries ?? "").toLowerCase();
  const f = (c.pixFmt ?? "").toLowerCase();
  return t === "arib-std-b67" || t === "smpte2084" || p === "bt2020" || /10le|10be|12le|12be/.test(f);
}

/** True when the stream already tells a player which primaries/transfer/matrix to use. */
export function isColorTagged(c: ColorSignal | null): boolean {
  return !!c && !!c.transfer && !!c.primaries && !!c.matrix;
}

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export function probeColor(filePath: string): Promise<ColorSignal | null> {
  return new Promise((resolve) => {
    execFile(
      FFPROBE,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,color_transfer,color_primaries,color_space,color_range", "-of", "json", filePath],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          const s = (JSON.parse(String(stdout)).streams?.[0] ?? {}) as Record<string, string | undefined>;
          const norm = (v: string | undefined) => (v && v !== "unknown" ? v : null);
          resolve({
            codec: norm(s.codec_name),
            transfer: norm(s.color_transfer),
            primaries: norm(s.color_primaries),
            matrix: norm(s.color_space),
            range: norm(s.color_range),
            pixFmt: norm(s.pix_fmt),
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}
