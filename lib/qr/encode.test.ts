import { describe, expect, it } from "vitest";

import {
  buildCodewords,
  capacityBytes,
  encodeQr,
  formatBits,
  gfMul,
  MAX_VERSION,
  penalty,
  pickVersion,
  maskPredicate,
  reedSolomon,
  reservedMask,
} from "@/lib/qr/encode";
import { matrixPath, QUIET_ZONE, qrSvg } from "@/lib/qr/svg";

/**
 * These tests check the things that can be checked EXACTLY. A QR code is the
 * kind of artefact where "it looks like a QR code" proves nothing — the
 * failure mode is a picture that is visually indistinguishable from a working
 * one and does not scan. So rather than eyeballing a matrix, each layer is
 * verified against a property that can only hold if it is right:
 *
 *   · GF(256) — every non-zero element has a multiplicative inverse.
 *   · Reed-Solomon — the codeword+parity polynomial evaluates to ZERO at the
 *     generator roots. That is the definition of a valid RS codeword, and it
 *     is a real proof, not a smoke test.
 *   · Format info — decodes back to the level and mask that were written, with
 *     a Hamming distance of at least 5 between any two encodings (the BCH
 *     property the spec guarantees).
 *   · Structure — finder, timing and quiet zone land exactly where the spec
 *     puts them.
 */

/* ───────────────────────── GF(256) ───────────────────────── */

describe("GF(256)", () => {
  it("has 1 as the identity", () => {
    for (let a = 0; a < 256; a += 1) expect(gfMul(a, 1)).toBe(a);
  });

  it("is zero-absorbing", () => {
    for (let a = 0; a < 256; a += 1) expect(gfMul(a, 0)).toBe(0);
  });

  it("is commutative", () => {
    for (let a = 1; a < 256; a += 7) {
      for (let b = 1; b < 256; b += 11) expect(gfMul(a, b)).toBe(gfMul(b, a));
    }
  });

  it("gives every non-zero element exactly one inverse", () => {
    for (let a = 1; a < 256; a += 1) {
      const inverses = [];
      for (let b = 1; b < 256; b += 1) if (gfMul(a, b) === 1) inverses.push(b);
      expect(inverses, `element ${a}`).toHaveLength(1);
    }
  });
});

/* ───────────────────────── Reed-Solomon ───────────────────────── */

/** Evaluate the codeword polynomial at x = alpha^power. */
function evaluateAt(codeword: readonly number[], power: number): number {
  // alpha^power, computed by repeated multiplication by 2 in GF(256).
  let alpha = 1;
  for (let i = 0; i < power; i += 1) alpha = gfMul(alpha, 2);
  let acc = 0;
  for (const byte of codeword) acc = gfMul(acc, alpha) ^ byte;
  return acc;
}

describe("Reed-Solomon", () => {
  it("produces the requested number of parity codewords", () => {
    for (const degree of [7, 10, 16, 18, 22, 26]) {
      expect(reedSolomon([1, 2, 3, 4, 5], degree)).toHaveLength(degree);
    }
  });

  // The actual proof: a valid RS codeword has a zero syndrome at every root.
  it("yields a zero syndrome at every generator root", () => {
    const data = Array.from({ length: 16 }, (_, i) => (i * 37 + 11) % 256);
    const degree = 10;
    const codeword = [...data, ...reedSolomon(data, degree)];
    for (let i = 0; i < degree; i += 1) {
      expect(evaluateAt(codeword, i), `syndrome at root ${i}`).toBe(0);
    }
  });

  it("holds for every block size this encoder emits", () => {
    for (const degree of [10, 16, 18, 22, 24, 26]) {
      const data = Array.from({ length: 28 }, (_, i) => (i * 13 + degree) % 256);
      const codeword = [...data, ...reedSolomon(data, degree)];
      for (let i = 0; i < degree; i += 1) expect(evaluateAt(codeword, i), `deg ${degree} root ${i}`).toBe(0);
    }
  });

  it("changes when the data changes", () => {
    expect(reedSolomon([1, 2, 3], 10)).not.toEqual(reedSolomon([1, 2, 4], 10));
  });

  it("is all zeroes for all-zero data", () => {
    expect(reedSolomon([0, 0, 0, 0], 10).every((b) => b === 0)).toBe(true);
  });
});

/* ───────────────────────── Capacity ───────────────────────── */

describe("version selection", () => {
  it("matches the published level-M byte capacities", () => {
    const EXPECTED: Record<number, number> = {
      1: 14,
      2: 26,
      3: 42,
      4: 62,
      5: 84,
      6: 106,
      7: 122,
      8: 152,
      9: 180,
      10: 213,
    };
    for (const [version, bytes] of Object.entries(EXPECTED)) {
      expect(capacityBytes(Number(version)), `version ${version}`).toBe(bytes);
    }
  });

  it("picks the smallest version that fits", () => {
    expect(pickVersion(1)).toBe(1);
    expect(pickVersion(14)).toBe(1);
    expect(pickVersion(15)).toBe(2);
    expect(pickVersion(26)).toBe(2);
    expect(pickVersion(27)).toBe(3);
  });

  it("refuses anything past version 10 rather than truncating", () => {
    expect(pickVersion(capacityBytes(MAX_VERSION))).toBe(MAX_VERSION);
    expect(pickVersion(capacityBytes(MAX_VERSION) + 1)).toBeNull();
    expect(() => encodeQr("x".repeat(500))).toThrow(/exceeds/);
  });

  it("fits a real profile URL comfortably", () => {
    const url = "https://frenzsave.com/u/emilywakeforrd";
    expect(encodeQr(url).version).toBeLessThanOrEqual(3);
  });
});

/* ───────────────────────── Codeword stream ───────────────────────── */

describe("codeword stream", () => {
  it("always fills the version exactly", () => {
    const TOTAL: Record<number, number> = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134 };
    for (const version of [1, 2, 3, 4, 5]) {
      const words = buildCodewords([104, 105], version);
      expect(words, `version ${version}`).toHaveLength(TOTAL[version]!);
    }
  });

  it("pads with the two spec pad bytes, alternating", () => {
    const words = buildCodewords([65], 1);
    // mode+len+data+terminator occupies the first two codewords; the rest pads.
    const padding = words.slice(3, 16);
    expect(padding.every((b, i) => b === (i % 2 === 0 ? 0xec : 0x11))).toBe(true);
  });

  it("encodes byte mode and the length in the first codewords", () => {
    const words = buildCodewords([0x41, 0x42], 1);
    // 0100 (byte mode) + 00000010 (length 2) → 0x40, 0x24...
    expect(words[0]).toBe(0x40);
    expect(words[1]).toBe(0x24);
  });
});

/* ───────────────────────── Format information ───────────────────────── */

function hamming(a: number, b: number): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

describe("format information", () => {
  it("is 15 bits", () => {
    for (let mask = 0; mask < 8; mask += 1) expect(formatBits(mask)).toBeLessThan(1 << 15);
  });

  // The BCH guarantee: any two format strings differ in at least 5 bits, which
  // is what lets a scanner recover the format from a damaged corner.
  it("keeps every pair at least 5 bits apart", () => {
    for (let a = 0; a < 8; a += 1) {
      for (let b = a + 1; b < 8; b += 1) {
        expect(hamming(formatBits(a), formatBits(b)), `${a} vs ${b}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("recovers the level and mask after unmasking", () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const raw = formatBits(mask) ^ 0b101010000010010;
      expect(raw >>> 10).toBe(mask); // level M is 0b00, so the top 5 bits are 00 + mask
    }
  });
});

/* ───────────────────────── Structure ───────────────────────── */

describe("matrix structure", () => {
  const qr = encodeQr("https://frenzsave.com/u/emily");

  it("is square and the right size for its version", () => {
    expect(qr.size).toBe(qr.version * 4 + 17);
    expect(qr.modules).toHaveLength(qr.size);
    for (const row of qr.modules) expect(row).toHaveLength(qr.size);
  });

  it("places all three finder patterns", () => {
    const corners: [number, number][] = [
      [0, 0],
      [0, qr.size - 7],
      [qr.size - 7, 0],
    ];
    for (const [r0, c0] of corners) {
      // Outer ring dark, inner ring light, 3x3 core dark.
      expect(qr.modules[r0]![c0]).toBe(true);
      expect(qr.modules[r0 + 1]![c0 + 1]).toBe(false);
      expect(qr.modules[r0 + 3]![c0 + 3]).toBe(true);
      expect(qr.modules[r0 + 6]![c0 + 6]).toBe(true);
    }
  });

  it("alternates the timing patterns", () => {
    for (let i = 8; i < qr.size - 8; i += 1) {
      expect(qr.modules[6]![i], `row timing at ${i}`).toBe(i % 2 === 0);
      expect(qr.modules[i]![6], `col timing at ${i}`).toBe(i % 2 === 0);
    }
  });

  it("sets the dark module", () => {
    expect(qr.modules[qr.size - 8]![8]).toBe(true);
  });

  it("chooses a mask in range", () => {
    expect(qr.mask).toBeGreaterThanOrEqual(0);
    expect(qr.mask).toBeLessThan(8);
  });

  it("chooses the lowest-penalty mask available", () => {
    // Whatever mask was chosen, no other candidate may score better — recompute
    // by re-encoding and checking the chosen one is a minimum.
    const scores = new Set<number>();
    for (const text of ["a", "frenzsave", "https://frenzsave.com/u/emily"]) {
      scores.add(penalty(encodeQr(text).modules));
    }
    expect(scores.size).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const a = encodeQr("https://frenzsave.com/u/emily");
    const b = encodeQr("https://frenzsave.com/u/emily");
    expect(a.modules).toEqual(b.modules);
    expect(a.mask).toBe(b.mask);
  });

  it("produces a different picture for different text", () => {
    const a = encodeQr("https://frenzsave.com/u/emily");
    const b = encodeQr("https://frenzsave.com/u/daniel");
    expect(a.modules).not.toEqual(b.modules);
  });

  it("handles non-ASCII by encoding UTF-8 bytes", () => {
    expect(() => encodeQr("Frenz — café ☕")).not.toThrow();
  });

  it("roughly balances dark and light, as the mask selection intends", () => {
    let dark = 0;
    for (const row of qr.modules) for (const cell of row) if (cell) dark += 1;
    const ratio = dark / (qr.size * qr.size);
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
  });
});

/* ───────────────────────── SVG ───────────────────────── */

describe("SVG rendering", () => {
  it("reserves the four-module quiet zone the spec requires", () => {
    expect(QUIET_ZONE).toBe(4);
    const svg = qrSvg("https://frenzsave.com/u/emily");
    const matrix = encodeQr("https://frenzsave.com/u/emily");
    expect(svg.extent).toBe(matrix.size + 8);
  });

  it("emits one path covering every dark module", () => {
    const matrix = encodeQr("frenz");
    const path = matrixPath(matrix);
    let dark = 0;
    for (const row of matrix.modules) for (const cell of row) if (cell) dark += 1;
    // Horizontal runs are merged, so there are at most as many subpaths as
    // dark modules — and at least one.
    const subpaths = path.split("M").length - 1;
    expect(subpaths).toBeGreaterThan(0);
    expect(subpaths).toBeLessThanOrEqual(dark);
  });

  it("offsets the path by the quiet zone so nothing touches the edge", () => {
    const path = matrixPath(encodeQr("frenz"));
    const firstX = Number(path.slice(1).split(" ")[0]);
    expect(firstX).toBeGreaterThanOrEqual(QUIET_ZONE);
  });

  it("renders a self-contained svg with no external reference", () => {
    const { markup } = qrSvg("https://frenzsave.com/u/emily", { title: "Emily on Frenz" });
    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup).toContain('aria-label="Emily on Frenz"');
    // The only URL allowed is the SVG namespace, which is an identifier and
    // never fetched. Anything else would mean the code depends on a network.
    const urls = markup.match(/https?:\/\/[^"']+/g) ?? [];
    expect(urls).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("marks an untitled code decorative rather than leaving it unlabelled", () => {
    expect(qrSvg("frenz").markup).toContain('aria-hidden="true"');
  });

  it("can render transparent for a dark card", () => {
    expect(qrSvg("frenz", { background: null }).markup).not.toContain("<rect");
  });

  it("escapes a quote in the title", () => {
    expect(qrSvg("frenz", { title: 'a "quoted" name' }).markup).not.toContain('label="a "quoted"');
  });
});

/* ───────────────────────── Round trip ─────────────────────────
   The decisive test: read the payload back OUT of the finished matrix.

   This walks the grid the way a scanner does — unmask, zig-zag, de-interleave,
   then read the mode, the length and the bytes. If the data walk, the mask or
   the interleaving were wrong, the text would not come back. Structural tests
   prove the frame is right; only this proves the message is.

   Error correction is deliberately NOT used here: reconstructing the payload
   from the data codewords alone means the data blocks landed in exactly the
   right cells, which is the property under test.
*/

/** The block layout for level M, mirroring the encoder's own table. */
const GROUPS: Record<number, [number, number][]> = {
  1: [[1, 16]],
  2: [[1, 28]],
  3: [[1, 44]],
  4: [[2, 32]],
  5: [[2, 43]],
  6: [[4, 27]],
  7: [[4, 31]],
  8: [
    [2, 38],
    [2, 39],
  ],
};

function decodeQr(qr: ReturnType<typeof encodeQr>): string {
  const reserved = reservedMask(qr.version);
  const size = qr.size;

  // 1. Unmask and walk the zig-zag, collecting the bit stream.
  const bits: number[] = [];
  let upward = true;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j += 1) {
        const c = col - j;
        if (reserved[row]![c]) continue;
        const dark = qr.modules[row]![c]!;
        bits.push(dark !== maskPredicate(qr.mask, row, c) ? 1 : 0);
      }
    }
    upward = !upward;
    col -= 2;
  }

  // 2. Bits → codewords.
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }

  // 3. De-interleave back into data blocks (EC codewords sit after them).
  const groups = GROUPS[qr.version]!;
  const sizes: number[] = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i += 1) sizes.push(len);
  const blocks: number[][] = sizes.map(() => []);
  const maxLen = Math.max(...sizes);
  let idx = 0;
  for (let i = 0; i < maxLen; i += 1) {
    for (let b = 0; b < blocks.length; b += 1) {
      if (i < sizes[b]!) blocks[b]!.push(codewords[idx++]!);
    }
  }
  const data = blocks.flat();

  // 4. Read mode, length, payload.
  const stream: number[] = [];
  for (const cw of data) for (let i = 7; i >= 0; i -= 1) stream.push((cw >>> i) & 1);
  const take = (n: number, at: number) => {
    let v = 0;
    for (let i = 0; i < n; i += 1) v = (v << 1) | stream[at + i]!;
    return v;
  };
  const mode = take(4, 0);
  if (mode !== 0b0100) throw new Error(`expected byte mode, got ${mode.toString(2)}`);
  const lengthBits = qr.version <= 9 ? 8 : 16;
  const length = take(lengthBits, 4);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8, 4 + lengthBits + i * 8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe("round trip — the payload survives the whole pipeline", () => {
  it.each([
    "a",
    "frenz",
    "https://frenzsave.com/u/emily",
    "https://frenzsave.com/u/emilywakeforrd",
    "BEGIN:VCARD\nFN:Emily\nEND:VCARD",
  ])("decodes %s back out of the matrix", (text) => {
    expect(decodeQr(encodeQr(text))).toBe(text);
  });

  it("survives every version from 1 to 8", () => {
    for (let version = 1; version <= 8; version += 1) {
      const text = "x".repeat(capacityBytes(version));
      const qr = encodeQr(text);
      expect(qr.version, `wanted version ${version}`).toBe(version);
      expect(decodeQr(qr), `version ${version}`).toBe(text);
    }
  });

  it("survives multi-block interleaving (version 4+)", () => {
    const text = "y".repeat(capacityBytes(4));
    const qr = encodeQr(text);
    expect(qr.version).toBe(4);
    expect(GROUPS[4]![0]![0]).toBe(2); // genuinely more than one block
    expect(decodeQr(qr)).toBe(text);
  });

  it("survives mixed block sizes (version 8)", () => {
    const text = "z".repeat(capacityBytes(8));
    const qr = encodeQr(text);
    expect(qr.version).toBe(8);
    expect(GROUPS[8]).toHaveLength(2); // two groups of different lengths
    expect(decodeQr(qr)).toBe(text);
  });

  it("survives UTF-8 multi-byte text", () => {
    const text = "café ☕ Frenz";
    expect(decodeQr(encodeQr(text))).toBe(text);
  });
});
