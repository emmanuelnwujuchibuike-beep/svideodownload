/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MP3 DURATION — measured from the frames, no ffmpeg (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Text to Audio finishes on the FRONTEND (the direct route in the request's
 * `after()`, the Replicate route in the webhook's) where there is no ffprobe.
 * The Audio Library shows a duration and Lip Sync Pro's estimate needs one,
 * so this walks the MPEG audio frames and adds them up: every frame carries
 * a fixed number of samples at the stream's sample rate, so the sum is exact
 * to within one frame (26 ms) for CBR and VBR alike — a Xing/Info frame is
 * counted like any other, which overstates by that one frame.
 *
 * Returns null for anything that is not MPEG audio (the caller stores the
 * file anyway and shows no duration rather than a wrong one).
 */
const BITRATES: Record<string, readonly number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface Mp3Frame {
  length: number;
  samples: number;
  sampleRate: number;
  bitrateKbps: number;
}

/** Parse one frame header at `offset`; null when the four bytes are not a valid MPEG audio header. */
export function parseMp3FrameHeader(buf: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > buf.length) return null;
  const b1 = buf[offset]!;
  const b2 = buf[offset + 1]!;
  const b3 = buf[offset + 2]!;
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const versionBits = (b2 >> 3) & 0x03; // 0 = MPEG 2.5, 1 = reserved, 2 = MPEG 2, 3 = MPEG 1
  const layerBits = (b2 >> 1) & 0x03; // 1 = Layer III, 2 = Layer II, 3 = Layer I
  if (versionBits === 1 || layerBits === 0) return null;
  const bitrateIndex = (b3 >> 4) & 0x0f;
  const sampleIndex = (b3 >> 2) & 0x03;
  const padding = (b3 >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const mpeg1 = versionBits === 3;
  const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3;
  const bitrate = BITRATES[`${mpeg1 ? 1 : 2}-${layer}`]![bitrateIndex]!;
  const sampleRate = SAMPLE_RATES[versionBits]![sampleIndex]!;
  if (!bitrate || !sampleRate) return null;
  let samples: number;
  let length: number;
  if (layer === 1) {
    samples = 384;
    length = (Math.floor((12 * bitrate * 1000) / sampleRate) + padding) * 4;
  } else if (layer === 2) {
    samples = 1152;
    length = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
  } else {
    samples = mpeg1 ? 1152 : 576;
    length = Math.floor(((mpeg1 ? 144 : 72) * bitrate * 1000) / sampleRate) + padding;
  }
  if (length < 24) return null;
  return { length, samples, sampleRate, bitrateKbps: bitrate };
}

/** The bytes of a leading ID3v2 tag, or 0. */
export function id3v2Length(buf: Uint8Array): number {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0;
  const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
  const footer = (buf[5]! & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

export interface Mp3Facts {
  durationMs: number;
  frames: number;
  sampleRate: number;
  /** The average over the frames — the nominal rate for CBR. */
  bitrateKbps: number;
}

export function mp3Facts(input: Uint8Array | ArrayBuffer): Mp3Facts | null {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  let offset = id3v2Length(buf);
  let frames = 0;
  let seconds = 0;
  let sampleRate = 0;
  let bitrateSum = 0;
  let junk = 0;
  while (offset + 4 <= buf.length) {
    const frame = parseMp3FrameHeader(buf, offset);
    if (!frame) {
      // an ID3v1 tag or trailing bytes end the stream; a little noise between frames is stepped over
      if (frames > 0 && buf.length - offset <= 128 && buf[offset] === 0x54 && buf[offset + 1] === 0x41 && buf[offset + 2] === 0x47) break;
      junk += 1;
      if (junk > 4096) break;
      offset += 1;
      continue;
    }
    // a candidate header must be followed by another valid header (or the end) — the guard against a 0xFFE inside audio data
    const nextOffset = offset + frame.length;
    if (nextOffset + 4 <= buf.length && !parseMp3FrameHeader(buf, nextOffset) && frames === 0) {
      offset += 1;
      continue;
    }
    frames += 1;
    seconds += frame.samples / frame.sampleRate;
    sampleRate = frame.sampleRate;
    bitrateSum += frame.bitrateKbps;
    offset = nextOffset;
  }
  if (frames === 0) return null;
  return { durationMs: Math.round(seconds * 1000), frames, sampleRate, bitrateKbps: Math.round(bitrateSum / frames) };
}

export function mp3DurationMs(input: Uint8Array | ArrayBuffer): number | null {
  return mp3Facts(input)?.durationMs ?? null;
}
