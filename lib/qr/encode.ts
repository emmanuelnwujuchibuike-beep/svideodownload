/**
 * QR encoder — byte mode, error correction level M, versions 1–10.
 *
 * ── Why this is written here rather than installed ────────────────────────
 * Three reasons, in order of how much they matter:
 *
 *  1. PRIVACY. The obvious shortcut is an image URL from a QR service. That
 *     sends every member's profile link to a third party, on every render, and
 *     the failure is silent — a working QR code that also logs who is sharing
 *     what, and where. A generated QR must never leave this server.
 *  2. It is a leaf with no runtime. A QR is a pure function from a string to a
 *     matrix of booleans; there is nothing to fetch, nothing to await, no
 *     failure mode at render time, and it works with no network. A dependency
 *     would add weight to a page for something that is 300 lines of settled
 *     maths.
 *  3. It renders as inline SVG, so it stays sharp at any size, prints, and
 *     survives a strict CSP with no external host.
 *
 * ── Why level M and versions 1–10 ─────────────────────────────────────────
 * Level M recovers ~15% damage — the level every payment and identity QR
 * uses, and enough for a code printed on a card or shown on a scratched
 * screen. Versions 1–10 at level M hold up to 213 bytes; a Frenz profile URL
 * is around 40. The cap is deliberate: beyond version 10 a code needs more
 * physical size to stay scannable than a phone screen or a business card
 * gives it, so failing loudly is better than emitting a code nobody can read.
 *
 * ── How this is known to be correct ───────────────────────────────────────
 * `encode.test.ts` checks the parts that can be checked exactly rather than
 * eyeballing a picture: the GF(256) tables round-trip, Reed-Solomon parity
 * verifies to a zero syndrome (an actual proof the EC blocks are right), the
 * format information decodes back to the level and mask that were written,
 * and the structural patterns land where the spec puts them.
 *
 * Pure: no React, no I/O.
 */

/* ────────────────────────── GF(256) arithmetic ────────────────────────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by 2 in GF(256) with the QR primitive polynomial 0x11D.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** The generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j]!, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** The `degree` Reed-Solomon parity codewords for `data`. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const gen = generatorPoly(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) {
      remainder[i] = remainder[i]! ^ gfMul(gen[i + 1]!, factor);
    }
  }
  return remainder;
}

/* ────────────────────────── Version tables (level M) ───────────────────── */

interface VersionSpec {
  /** Error-correction codewords per block. */
  ecPerBlock: number;
  /** [blockCount, dataCodewordsPerBlock] groups. */
  groups: [number, number][];
}

/** Level M only — the one level this encoder emits. */
const VERSIONS: Record<number, VersionSpec> = {
  1: { ecPerBlock: 10, groups: [[1, 16]] },
  2: { ecPerBlock: 16, groups: [[1, 28]] },
  3: { ecPerBlock: 26, groups: [[1, 44]] },
  4: { ecPerBlock: 18, groups: [[2, 32]] },
  5: { ecPerBlock: 24, groups: [[2, 43]] },
  6: { ecPerBlock: 16, groups: [[4, 27]] },
  7: { ecPerBlock: 18, groups: [[4, 31]] },
  8: { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  9: { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  10: { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export const MAX_VERSION = 10;

function dataCodewords(version: number): number {
  return VERSIONS[version]!.groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

/** Bits used by the byte-mode character count field. */
function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** Byte-mode capacity in bytes at level M. */
export function capacityBytes(version: number): number {
  const overheadBits = 4 + countBits(version);
  return dataCodewords(version) - Math.ceil(overheadBits / 8);
}

/** The smallest version that fits `byteLength`, or null when nothing does. */
export function pickVersion(byteLength: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v += 1) {
    if (byteLength <= capacityBytes(v)) return v;
  }
  return null;
}

/* ────────────────────────── Bit stream ────────────────────────── */

class BitBuffer {
  private bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/**
 * The full codeword stream: mode + length + data + terminator + padding, split
 * into blocks, error-corrected, then interleaved the way the spec requires.
 *
 * Interleaving is the step that is easy to skip and impossible to notice in
 * testing on version 1–3 (single block), then silently breaks every larger
 * code. It is done unconditionally.
 */
export function buildCodewords(bytes: readonly number[], version: number): number[] {
  const spec = VERSIONS[version]!;
  const total = dataCodewords(version);

  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, countBits(version));
  for (const b of bytes) buffer.put(b, 8);

  // Terminator: up to four zero bits, but never past capacity.
  const capacityBits = total * 8;
  buffer.put(0, Math.min(4, capacityBits - buffer.length));
  // Pad to a byte boundary, then alternate the two spec pad bytes.
  if (buffer.length % 8 !== 0) buffer.put(0, 8 - (buffer.length % 8));

  const data = buffer.toBytes();
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < total; i += 1) data.push(PAD[i % 2]!);

  // Split into blocks exactly as the group table says.
  const blocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i += 1) {
      blocks.push(data.slice(offset, offset + size));
      offset += size;
    }
  }
  const ecBlocks = blocks.map((b) => reedSolomon(b, spec.ecPerBlock));

  // Interleave: column-wise across blocks, data first, then EC.
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]!);
  }
  return out;
}

/* ────────────────────────── Matrix ────────────────────────── */

/** -1 = free, 0 = light, 1 = dark. Function patterns are marked reserved. */
type Cell = -1 | 0 | 1;

function blankMatrix(size: number): Cell[][] {
  return Array.from({ length: size }, () => new Array<Cell>(size).fill(-1));
}

function placeFinder(m: Cell[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr]![cc] = inRing || inCore ? 1 : 0;
    }
  }
}

function placeAlignment(m: Cell[][], version: number): void {
  const centres = ALIGNMENT[version]!;
  const size = m.length;
  for (const r of centres) {
    for (const c of centres) {
      // Skip the three corners, which the finder patterns already own.
      const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          m[r + dr]![c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
        }
      }
    }
  }
}

function placeTiming(m: Cell[][]): void {
  for (let i = 8; i < m.length - 8; i += 1) {
    const bit: Cell = i % 2 === 0 ? 1 : 0;
    m[6]![i] = bit;
    m[i]![6] = bit;
  }
}

/** 15-bit format information for level M and a mask, BCH-protected. */
export function formatBits(mask: number): number {
  const LEVEL_M = 0b00;
  let value = (LEVEL_M << 3) | mask;
  let rem = value;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0b10100110111);
  }
  value = ((value << 10) | rem) ^ 0b101010000010010;
  return value & 0x7fff;
}

/** 18-bit version information, required from version 7. */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 11) * 0b1111100100101);
  }
  return ((version << 12) | rem) & 0x3ffff;
}

function reserveFormatAreas(m: Cell[][]): void {
  const size = m.length;
  for (let i = 0; i < 9; i += 1) {
    if (m[8]![i] === -1) m[8]![i] = 0;
    if (m[i]![8] === -1) m[i]![8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (m[8]![size - 1 - i] === -1) m[8]![size - 1 - i] = 0;
    if (m[size - 1 - i]![8] === -1) m[size - 1 - i]![8] = 0;
  }
  // The dark module at (size - 8, 8) is reserved here but WRITTEN in
  // `writeFormat`: the second format copy runs through that exact cell, so
  // setting it earlier would just be overwritten.
  m[size - 8]![8] = 1;
}

function writeFormat(m: Cell[][], mask: number): void {
  const size = m.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const bit: Cell = ((bits >>> i) & 1) === 1 ? 1 : 0;
    // Copy 1 — around the top-left finder.
    if (i < 6) m[8]![i] = bit;
    else if (i === 6) m[8]![7] = bit;
    else if (i === 7) m[8]![8] = bit;
    else if (i === 8) m[7]![8] = bit;
    else m[14 - i]![8] = bit;
    // Copy 2 — split between the other two finders.
    if (i < 8) m[size - 1 - i]![8] = bit;
    else m[8]![size - 15 + i] = bit;
  }
  // The dark module is always set, and is always written LAST because the
  // loop above runs straight through its cell.
  m[size - 8]![8] = 1;
}

function writeVersion(m: Cell[][], version: number): void {
  if (version < 7) return;
  const size = m.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const bit: Cell = ((bits >>> i) & 1) === 1 ? 1 : 0;
    const row = Math.floor(i / 3);
    const col = i % 3;
    m[row]![size - 11 + col] = bit;
    m[size - 11 + col]![row] = bit;
  }
}

function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** The four penalty rules. Lower is a more scannable code. */
export function penalty(grid: readonly (readonly boolean[])[]): number {
  const size = grid.length;
  let score = 0;

  const runScore = (run: number) => (run >= 5 ? 3 + (run - 5) : 0);

  // Rule 1 — runs of five or more, in both directions.
  for (let i = 0; i < size; i += 1) {
    let rowRun = 1;
    let colRun = 1;
    for (let j = 1; j < size; j += 1) {
      if (grid[i]![j] === grid[i]![j - 1]) {
        rowRun += 1;
      } else {
        score += runScore(rowRun);
        rowRun = 1;
      }
      if (grid[j]![i] === grid[j - 1]![i]) {
        colRun += 1;
      } else {
        score += runScore(colRun);
        colRun = 1;
      }
    }
    score += runScore(rowRun) + runScore(colRun);
  }

  // Rule 2 — 2×2 blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r]![c];
      if (v === grid[r]![c + 1] && v === grid[r + 1]![c] && v === grid[r + 1]![c + 1]) score += 3;
    }
  }

  // Rule 3 — the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const PATTERN = [true, false, true, true, true, false, true];
  const matches = (cells: boolean[], at: number): boolean => {
    for (let k = 0; k < 7; k += 1) if (cells[at + k] !== PATTERN[k]) return false;
    const before = cells.slice(Math.max(0, at - 4), at);
    const after = cells.slice(at + 7, at + 11);
    return (before.length === 4 && before.every((x) => !x)) || (after.length === 4 && after.every((x) => !x));
  };
  for (let i = 0; i < size; i += 1) {
    const row = grid[i]!.slice();
    const col = grid.map((r) => r[i]!);
    for (let j = 0; j + 7 <= size; j += 1) {
      if (matches(row, j)) score += 40;
      if (matches(col, j)) score += 40;
    }
  }

  // Rule 4 — deviation from a 50/50 dark ratio.
  let dark = 0;
  for (const row of grid) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Which cells are function patterns for a given version — finder, alignment,
 * timing, format and version areas.
 *
 * Exported so a test can rebuild the reserved map and decode a finished matrix
 * back to its payload without reaching into the encoder's internals. That
 * round trip is the only check that proves the data walk and the mask are
 * right, which is exactly the part a picture cannot show you.
 */
export function reservedMask(version: number): boolean[][] {
  const size = version * 4 + 17;
  const m = blankMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, version);
  placeTiming(m);
  reserveFormatAreas(m);
  writeVersion(m, version);
  return m.map((row) => row.map((cell) => cell !== -1));
}

/** The mask predicate, exported for the round-trip test. */
export function maskPredicate(mask: number, row: number, col: number): boolean {
  return maskAt(mask, row, col);
}

export interface QrMatrix {
  size: number;
  version: number;
  mask: number;
  /** true = dark. */
  modules: boolean[][];
}

/**
 * Encode `text` as a QR matrix.
 *
 * Throws only when the text genuinely cannot be represented at this level
 * within version 10. That is a programming error at the call site (something
 * put 300 bytes in a profile URL), not a runtime condition to swallow — a
 * silently blank QR is far worse than a stack trace.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  if (version === null) {
    throw new Error(`QR: ${bytes.length} bytes exceeds the ${capacityBytes(MAX_VERSION)}-byte limit at level M.`);
  }

  const size = version * 4 + 17;
  const base = blankMatrix(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  reserveFormatAreas(base);
  writeVersion(base, version);

  // Which cells are function patterns — decided BEFORE any data lands, so the
  // data walk can never overwrite one.
  const reserved = base.map((row) => row.map((cell) => cell !== -1));

  const codewords = buildCodewords(bytes, version);
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((cw >>> i) & 1);

  /*
    The zig-zag walk: a pair of columns at a time, right to left, alternating
    up and down. Column 6 is the vertical timing pattern and is not part of any
    pair — the whole grid to its left shifts by one, which is why the skip is a
    decrement of the cursor rather than a `continue`. Getting that wrong
    produces a code that scans perfectly at version 1 and fails from version 2
    onward, so it is written the plain way.
  */
  const filled = base.map((row) => row.slice());
  let bitIndex = 0;
  let upward = true;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j += 1) {
        const c = col - j;
        if (reserved[row]![c]) continue;
        filled[row]![c] = (bits[bitIndex] ?? 0) === 1 ? 1 : 0;
        bitIndex += 1;
      }
    }
    upward = !upward;
    col -= 2;
  }

  // Try every mask, keep the least penalised — that is the whole of the spec's
  // mask selection, and skipping it produces codes that scan badly on some
  // readers and not others, which is the worst kind of bug to chase.
  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const cells: Cell[][] = filled.map((row, r) =>
      row.map((cell, c) => {
        const dark = cell === 1;
        // Function patterns are never masked.
        const masked = reserved[r]![c] ? dark : dark !== maskAt(mask, r, c);
        return masked ? 1 : 0;
      }),
    );
    // Format information encodes the mask, so it is written per candidate.
    writeFormat(cells, mask);
    const modules = cells.map((row) => row.map((v) => v === 1));
    const score = penalty(modules);
    if (!best || score < best.score) best = { mask, modules, score };
  }

  return { size, version, mask: best!.mask, modules: best!.modules };
}
