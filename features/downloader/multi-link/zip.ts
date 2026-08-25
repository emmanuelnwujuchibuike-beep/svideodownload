/**
 * A minimal, STORE-ONLY ZIP writer — roughly 120 lines, zero dependencies.
 *
 * ── Why not a library (§26: "Avoid adding large dependencies for simple
 *    functionality") ─────────────────────────────────────────────────────────
 * JSZip is ~95 kB minified and fflate ~30 kB, and both exist to do the one
 * thing this file deliberately does not: DEFLATE. Every payload here is a
 * JPEG, PNG or WebP — already entropy-coded, so deflate returns roughly 0-2%
 * on them while costing CPU and main-thread time on exactly the low-end phones
 * §27 is about. Stored entries (method 0) are the honest choice for media, and
 * once compression is off a ZIP is just headers around bytes.
 *
 * ── Why images only ───────────────────────────────────────────────────────
 * A ZIP has to exist in memory before it can be handed to the browser, so a
 * batch of videos would mean holding hundreds of megabytes in a tab that iOS
 * Safari will simply kill. §15 anticipates this — "do not force ZIP generation
 * for media types where it is inefficient" — so `zipEligible` (state.ts) only
 * offers it when every selected item is an image, and `MAX_ZIP_BYTES` below is
 * a second, absolute stop. Videos download individually through the manager,
 * which streams them to disk and never holds a whole file.
 */

/** Absolute ceiling for one ZIP. Past this the offer is withdrawn rather than
 *  attempted — a tab killed mid-build loses the whole batch, which is worse
 *  than not offering the convenience. */
export const MAX_ZIP_BYTES = 150 * 1024 * 1024;

export interface ZipEntry {
  /** Path inside the archive, e.g. `Source 1/Post 1.jpg`. */
  path: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time. A fixed, valid timestamp rather than `new Date()` — the
 *  archive's contents are what matter and a stable one keeps output
 *  reproducible. 1980-01-01 is the DOS epoch, which every unzip accepts. */
const DOS_TIME = 0;
const DOS_DATE = 33; // (1980-1980)<<9 | 1<<5 | 1

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n & 0xffff, true);
    this.push(b);
  }

  u32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    this.push(b);
  }

  blob(type: string): Blob {
    return new Blob(this.parts as BlobPart[], { type });
  }
}

/**
 * Builds a ZIP from entries that are already in memory.
 *
 * Flag bit 11 (0x0800) marks filenames as UTF-8, which is what lets a post
 * title with an accent or an emoji survive into the extracted filename instead
 * of arriving mojibake'd on Windows.
 */
export function buildZip(entries: ZipEntry[]): Blob {
  const w = new ByteWriter();
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];
  const enc = new TextEncoder();

  for (const entry of entries) {
    const name = enc.encode(entry.path);
    const crc = crc32(entry.bytes);
    const offset = w.length;

    w.u32(0x04034b50); // local file header signature
    w.u16(20); // version needed
    w.u16(0x0800); // flags: UTF-8 filename
    w.u16(0); // method: stored
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(crc);
    w.u32(entry.bytes.length); // compressed size == uncompressed (stored)
    w.u32(entry.bytes.length);
    w.u16(name.length);
    w.u16(0); // extra length
    w.push(name);
    w.push(entry.bytes);

    central.push({ name, crc, size: entry.bytes.length, offset });
  }

  const cdOffset = w.length;
  for (const e of central) {
    w.u32(0x02014b50); // central directory header signature
    w.u16(20); // version made by
    w.u16(20); // version needed
    w.u16(0x0800);
    w.u16(0);
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(e.crc);
    w.u32(e.size);
    w.u32(e.size);
    w.u16(e.name.length);
    w.u16(0); // extra
    w.u16(0); // comment
    w.u16(0); // disk number start
    w.u16(0); // internal attrs
    w.u32(0); // external attrs
    w.u32(e.offset);
    w.push(e.name);
  }
  const cdSize = w.length - cdOffset;

  w.u32(0x06054b50); // end of central directory
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(cdSize);
  w.u32(cdOffset);
  w.u16(0); // comment length

  return w.blob("application/zip");
}

/**
 * Filesystem-safe entry name.
 *
 * Windows rejects `\ / : * ? " < > |` outright and silently mangles trailing
 * dots and spaces — an archive that extracts everywhere except Windows is a
 * bug report, not a feature.
 */
export function safeEntryName(title: string, index: number, ext: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 60);
  const base = cleaned || `Post ${index + 1}`;
  return `${String(index + 1).padStart(2, "0")} ${base}.${ext}`;
}

/** The extension implied by a URL or content type, defaulting to jpg. */
export function extensionFor(url: string, contentType?: string | null): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("gif")) return "gif";
  if (/\.png(\?|$)/i.test(url)) return "png";
  if (/\.webp(\?|$)/i.test(url)) return "webp";
  if (/\.gif(\?|$)/i.test(url)) return "gif";
  return "jpg";
}
