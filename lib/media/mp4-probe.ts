/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT A VIDEO REALLY IS — from its own index, without downloading it
 *  (Stories Part 4, 2026-10-26, audit B7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MP4 and QuickTime (.mov) files are a list of boxes; the `moov` box is the index — the duration (`mvhd`) and each
 * track's codec (`trak/mdia/minf/stbl/stsd`). It is a few kilobytes even for a long video, at the start of a file
 * made for the web or at the END of one straight off a camera (an iPhone .mov). So this reads the first 64 KB, walks
 * the top-level boxes by their headers (one small range request per box it has to skip past), and reads only `moov`.
 *
 * Pure over a `read(start, end)` function — the caller decides where bytes come from (a range request to our own
 * storage, a test's buffer). No dependency. Anything it cannot read is reported as such, never guessed.
 */

export interface VideoFacts {
  container: "mp4" | "mov";
  /** seconds, from the movie header; null when the file states none */
  durationSec: number | null;
  /** the first video track's sample format: "avc1" (H.264), "hvc1"/"hev1" (HEVC), "av01", "vp09"… null = no video track */
  videoCodec: string | null;
}
export type ProbeError = "unreadable" | "not_mp4" | "index_too_large";
export type RangeRead = (start: number, endInclusive: number) => Promise<{ bytes: Uint8Array; total: number | null } | null>;

const HEAD_BYTES = 64 * 1024;
/** A moov over this is not a story-length clip (a 60 s phone video's index is well under 1 MB). */
const MAX_MOOV = 8 * 1024 * 1024;
/** Top-level boxes it will walk past before giving up. */
const MAX_BOXES = 32;
const TOP_LEVEL = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip", "uuid", "pnot", "meta", "moof", "mfra", "styp", "sidx", "pdin"]);

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0);
const u64 = (b: Uint8Array, at: number) => {
  const v = new DataView(b.buffer, b.byteOffset + at, 8);
  return v.getUint32(0) * 2 ** 32 + v.getUint32(4);
};

export async function probeMp4(read: RangeRead): Promise<VideoFacts | { error: ProbeError }> {
  const head = await read(0, HEAD_BYTES - 1);
  if (!head || head.bytes.length < 8) return { error: "unreadable" };
  const total = head.total;
  const bytesAt = async (start: number, length: number): Promise<Uint8Array | null> => {
    if (start + length <= head.bytes.length) return head.bytes.subarray(start, start + length);
    const r = await read(start, start + length - 1);
    return r && r.bytes.length >= Math.min(length, 8) ? r.bytes : null;
  };

  let container: "mp4" | "mov" = "mp4";
  let offset = 0;
  for (let n = 0; n < MAX_BOXES; n++) {
    if (total !== null && offset >= total) break;
    const h = await bytesAt(offset, 16);
    if (!h || h.length < 8) return { error: n === 0 ? "unreadable" : "unreadable" };
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    if (n === 0 && !TOP_LEVEL.has(type)) return { error: "not_mp4" };
    let headerLen = 8;
    if (size === 1) {
      if (h.length < 16) return { error: "unreadable" };
      size = u64(h, 8);
      headerLen = 16;
    } else if (size === 0) {
      if (total === null) return { error: "unreadable" };
      size = total - offset;
    }
    if (size < headerLen) return { error: "unreadable" };
    if (type === "ftyp" && h.length >= 12 && fourcc(h, 8) === "qt  ") container = "mov";
    if (type === "moov") {
      if (size > MAX_MOOV) return { error: "index_too_large" };
      const moov = await bytesAt(offset + headerLen, size - headerLen);
      if (!moov || moov.length < size - headerLen) return { error: "unreadable" };
      return { container, ...readMoov(moov) };
    }
    offset += size;
  }
  return { error: "unreadable" };
}

/** Child boxes of a container's payload. */
function* children(b: Uint8Array): Generator<{ type: string; body: Uint8Array }> {
  let at = 0;
  while (at + 8 <= b.length) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let headerLen = 8;
    if (size === 1 && at + 16 <= b.length) {
      size = u64(b, at + 8);
      headerLen = 16;
    } else if (size === 0) size = b.length - at;
    if (size < headerLen || at + size > b.length) return;
    yield { type, body: b.subarray(at + headerLen, at + size) };
    at += size;
  }
}
const child = (b: Uint8Array, type: string) => {
  for (const c of children(b)) if (c.type === type) return c.body;
  return null;
};

function readMoov(moov: Uint8Array): { durationSec: number | null; videoCodec: string | null } {
  let durationSec: number | null = null;
  let videoCodec: string | null = null;
  for (const c of children(moov)) {
    if (c.type === "mvhd" && c.body.length >= 20) {
      const v1 = c.body[0] === 1;
      const timescale = u32(c.body, v1 ? 20 : 12);
      const duration = v1 ? u64(c.body, 24) : u32(c.body, 16);
      if (timescale > 0 && Number.isFinite(duration)) durationSec = duration / timescale;
    } else if (c.type === "trak" && videoCodec === null) {
      const mdia = child(c.body, "mdia");
      const hdlr = mdia ? child(mdia, "hdlr") : null;
      if (!mdia || !hdlr || hdlr.length < 12 || fourcc(hdlr, 8) !== "vide") continue;
      const stsd = child(child(child(mdia, "minf") ?? new Uint8Array(), "stbl") ?? new Uint8Array(), "stsd");
      // stsd: version+flags (4), entry count (4), then the first entry: size (4), format (4)
      if (stsd && stsd.length >= 16) videoCodec = fourcc(stsd, 12);
    }
  }
  return { durationSec, videoCodec };
}

/** A range reader over an https URL — 8 s each, and a server that ignores the range (a 200) is not read at all. */
export function httpRangeReader(url: string, fetchImpl: typeof fetch = fetch): RangeRead {
  return async (start, end) => {
    try {
      const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (res.status !== 206) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
      return { bytes: new Uint8Array(await res.arrayBuffer()), total: Number.isFinite(total) && total > 0 ? total : null };
    } catch {
      return null;
    }
  };
}
