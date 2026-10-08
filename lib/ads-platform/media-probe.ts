/**
 * What an uploaded creative REALLY is — read from its bytes, never from the
 * browser's word.
 *
 * The browser declares a type, a size, dimensions and a duration so it can
 * refuse a bad file BEFORE uploading it (fast, free). None of that is trusted:
 * the server reads the stored object and decides from these parsers.
 *
 * Only headers are read — never the whole file, and never through a Vercel
 * body or Railway memory:
 *   image  the first ≤ 1 MB (dimensions live in the first few kB, EXIF aside)
 *   MP4    the 8-byte box headers by range, then the `moov` box alone
 *          (wherever it is — a phone often writes it at the END)
 *   WebM   the first ≤ 1 MB (Info and Tracks precede the first Cluster)
 *
 * Pure apart from the `RangeReader` the caller supplies. Every parser returns
 * null rather than throwing on a malformed file; null means "could not be
 * verified", which the validator treats as invalid.
 */

export type ProbedMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "video/mp4" | "video/webm" | "video/quicktime";

export interface Sniffed {
  mime: ProbedMime;
  mediaType: "image" | "video";
}

export interface MediaFacts extends Sniffed {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
const i32be = (b: Uint8Array, i: number) => (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!;
const u64be = (b: Uint8Array, i: number) => u32be(b, i) * 2 ** 32 + u32be(b, i + 4);

const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VP", "f4v ", "dash", "mmp4", "MSNV", "3gp4", "3gp5", "3gp6"]);

/** The real type, from magic bytes. */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", mediaType: "image" };
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return { mime: "image/png", mediaType: "image" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { mime: "image/webp", mediaType: "image" };
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis") return { mime: "image/avif", mediaType: "image" };
    if (brand === "qt  ") return { mime: "video/quicktime", mediaType: "video" };
    if (MP4_BRANDS.has(brand)) return { mime: "video/mp4", mediaType: "video" };
    return null;
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = ascii(b, 0, Math.min(64, b.length));
    return head.includes("webm") ? { mime: "video/webm", mediaType: "video" } : null;
  }
  return null;
}

/* ───────────────────────────────── images ───────────────────────────────── */

/** EXIF orientation 5–8 means the stored pixels are turned 90°: width and height swap on screen. */
function jpegExifRotated(seg: Uint8Array): boolean {
  if (ascii(seg, 0, 6) !== "Exif\0\0") return false;
  const t = 6;
  const le = ascii(seg, t, 2) === "II";
  const r16 = (i: number) => (le ? u16le(seg, t + i) : u16be(seg, t + i));
  const r32 = (i: number) => (le ? u16le(seg, t + i) + u16le(seg, t + i + 2) * 65536 : u32be(seg, t + i));
  if (t + 8 > seg.length) return false;
  const ifd = r32(4);
  if (t + ifd + 2 > seg.length) return false;
  const n = r16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (t + e + 12 > seg.length) return false;
    if (r16(e) === 0x0112) return r16(e + 8) >= 5 && r16(e + 8) <= 8;
  }
  return false;
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  let rotated = false;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (m === 0xe1) rotated ||= jpegExifRotated(b.subarray(i + 4, Math.min(b.length, i + 2 + len)));
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) {
      const h = u16be(b, i + 5);
      const w = u16be(b, i + 7);
      if (!w || !h) return null;
      return rotated ? { width: h, height: w } : { width: w, height: h };
    }
    if (m === 0xda || m === 0xd9) return null;
    i += 2 + len;
  }
  return null;
}

function avifSize(b: Uint8Array): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  for (let i = 4; i + 16 <= b.length; i++) {
    if (b[i] === 0x69 && ascii(b, i, 4) === "ispe") {
      const w = u32be(b, i + 8);
      const h = u32be(b, i + 12);
      if (w && h && (!best || w * h > best.width * best.height)) best = { width: w, height: h };
    }
  }
  if (!best) return null;
  for (let i = 4; i + 9 <= b.length; i++) {
    if (b[i] === 0x69 && ascii(b, i, 4) === "irot" && (b[i + 4]! & 3) % 2 === 1) return { width: best.height, height: best.width };
  }
  return best;
}

/** Display dimensions of an image from its leading bytes, or null when they are not enough / not valid. */
export function imageSize(b: Uint8Array, mime: ProbedMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
      return { width: u32be(b, 16), height: u32be(b, 20) };
    }
    if (mime === "image/jpeg") return jpegSize(b);
    if (mime === "image/webp") {
      if (b.length < 30) return null;
      const chunk = ascii(b, 12, 4);
      if (chunk === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
      if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
      if (chunk === "VP8L") {
        if (b[20] !== 0x2f) return null;
        return { width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) };
      }
      return null;
    }
    if (mime === "image/avif") return avifSize(b);
  } catch {
    return null;
  }
  return null;
}

/* ───────────────────────────────── MP4 / MOV ──────────────────────────────── */

export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

interface Box {
  type: string;
  start: number;
  header: number;
  size: number;
}

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let i = from;
  let guard = 0;
  while (i + 8 <= to && guard++ < 512) {
    let size = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    let header = 8;
    if (size === 1) {
      if (i + 16 > to) return;
      size = u64be(b, i + 8);
      header = 16;
    } else if (size === 0) size = to - i;
    if (size < header || i + size > to) return;
    yield { type, start: i, header, size };
    i += size;
  }
}

function parseMoov(m: Uint8Array): { durationSeconds: number | null; width: number | null; height: number | null } {
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  for (const box of boxes(m, 8, m.length)) {
    const c = box.start + box.header;
    if (box.type === "mvhd") {
      const v = m[c]!;
      const timescale = v === 1 ? u32be(m, c + 20) : u32be(m, c + 12);
      const dur = v === 1 ? u64be(m, c + 24) : u32be(m, c + 16);
      if (timescale > 0 && dur > 0 && dur !== 0xffffffff) duration = dur / timescale;
    } else if (box.type === "trak") {
      let tk: { w: number; h: number; rotated: boolean } | null = null;
      let isVideo = false;
      const end = box.start + box.size;
      for (const child of boxes(m, c, end)) {
        const cc = child.start + child.header;
        if (child.type === "tkhd") {
          const v = m[cc]!;
          // tkhd: version/flags, times, track id, reserved, duration, reserved[2], layer, group, volume, reserved, THEN the matrix
          const matrix = cc + (v === 1 ? 52 : 40);
          const wAt = matrix + 36;
          const a = i32be(m, matrix);
          const d = i32be(m, matrix + 16);
          tk = { w: Math.round(u32be(m, wAt) / 65536), h: Math.round(u32be(m, wAt + 4) / 65536), rotated: a === 0 && d === 0 };
        } else if (child.type === "mdia") {
          for (const md of boxes(m, cc, child.start + child.size)) {
            if (md.type === "hdlr" && ascii(m, md.start + md.header + 8, 4) === "vide") isVideo = true;
          }
        }
      }
      if (isVideo && tk && tk.w > 0 && tk.h > 0 && width === null) {
        width = tk.rotated ? tk.h : tk.w;
        height = tk.rotated ? tk.w : tk.h;
      }
    }
  }
  return { durationSeconds: duration, width, height };
}

const MAX_MOOV = 8 * 1024 * 1024;

/** Duration and display size of an MP4/MOV, reading only box headers and the moov box. */
export async function probeMp4(read: RangeReader, size: number): Promise<{ durationSeconds: number | null; width: number | null; height: number | null } | null> {
  let offset = 0;
  for (let guard = 0; guard < 64 && offset + 8 <= size; guard++) {
    const h = await read(offset, 16);
    if (h.length < 8) return null;
    let boxSize = u32be(h, 0);
    const type = ascii(h, 4, 4);
    if (boxSize === 1) {
      if (h.length < 16) return null;
      boxSize = u64be(h, 8);
    } else if (boxSize === 0) boxSize = size - offset;
    if (boxSize < 8 || !/^[\x20-\x7e]{4}$/.test(type)) return null;
    if (type === "moov") {
      if (boxSize > MAX_MOOV) return null;
      const moov = await read(offset, boxSize);
      return moov.length === boxSize ? parseMoov(moov) : null;
    }
    offset += boxSize;
  }
  return null;
}

/* ─────────────────────────────────── WebM ─────────────────────────────────── */

function vint(b: Uint8Array, i: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } | null {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = (first & (0xff >> len)) === 0xff >> len;
  for (let k = 1; k < len; k++) {
    value = value * 256 + b[i + k]!;
    if (b[i + k] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

const EBML = { segment: 0x18538067, info: 0x1549a966, tracks: 0x1654ae6b, entry: 0xae, video: 0xe0, cluster: 0x1f43b675, scale: 0x2ad7b1, duration: 0x4489, pw: 0xb0, ph: 0xba, dw: 0x54b0, dh: 0x54ba };
const MASTERS = new Set([EBML.segment, EBML.info, EBML.tracks, EBML.entry, EBML.video]);

/** Duration and size of a WebM from its leading bytes (Info + Tracks come before the first Cluster). */
export function probeWebm(b: Uint8Array): { durationSeconds: number | null; width: number | null; height: number | null } | null {
  let scale = 1_000_000;
  let rawDuration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  const walk = (from: number, to: number, depth: number): boolean => {
    let i = from;
    while (i < to && depth < 8) {
      const id = vint(b, i, true);
      if (!id) return false;
      const sz = vint(b, i + id.len, false);
      if (!sz) return false;
      const start = i + id.len + sz.len;
      const end = sz.unknown ? to : Math.min(to, start + sz.value);
      if (id.value === EBML.cluster) return true;
      if (MASTERS.has(id.value)) {
        if (walk(start, end, depth + 1)) return true;
      } else if (start + sz.value <= b.length) {
        const view = new DataView(b.buffer, b.byteOffset + start, Math.min(sz.value, 8));
        const uint = () => {
          let v = 0;
          for (let k = 0; k < sz.value && k < 8; k++) v = v * 256 + b[start + k]!;
          return v;
        };
        if (id.value === EBML.scale) scale = uint();
        else if (id.value === EBML.duration) rawDuration = sz.value === 4 ? view.getFloat32(0) : sz.value === 8 ? view.getFloat64(0) : null;
        else if (id.value === EBML.pw && width === null) width = uint();
        else if (id.value === EBML.ph && height === null) height = uint();
      }
      if (sz.unknown) return false;
      i = start + sz.value;
    }
    return false;
  };
  try {
    walk(0, b.length, 0);
  } catch {
    return null;
  }
  const durationSeconds = rawDuration !== null && rawDuration > 0 ? (rawDuration * scale) / 1e9 : null;
  if (durationSeconds === null && width === null) return null;
  return { durationSeconds, width, height };
}

/* ────────────────────────────────── the probe ─────────────────────────────── */

const HEAD = 256 * 1024;
const MORE = 1024 * 1024;

/** Everything the validator needs, read from the stored object through `read`. Null = unrecognised. */
export async function probeMedia(read: RangeReader, size: number): Promise<MediaFacts | null> {
  if (!(size > 0)) return null;
  let head = await read(0, Math.min(size, HEAD));
  const kind = sniff(head);
  if (!kind) return null;
  if (kind.mediaType === "image") {
    let dims = imageSize(head, kind.mime);
    if (!dims && size > head.length) {
      head = await read(0, Math.min(size, MORE));
      dims = imageSize(head, kind.mime);
    }
    return { ...kind, width: dims?.width ?? null, height: dims?.height ?? null, durationSeconds: null };
  }
  if (kind.mime === "video/webm") {
    const w = probeWebm(size > head.length ? await read(0, Math.min(size, MORE)) : head);
    return { ...kind, width: w?.width ?? null, height: w?.height ?? null, durationSeconds: w?.durationSeconds ?? null };
  }
  const m = await probeMp4(read, size);
  return { ...kind, width: m?.width ?? null, height: m?.height ?? null, durationSeconds: m?.durationSeconds ?? null };
}
