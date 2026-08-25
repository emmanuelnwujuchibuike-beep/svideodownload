import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildZip, extensionFor, safeEntryName, type ZipEntry } from "./zip";

/**
 * A hand-written binary format needs a real reader to check it, not a
 * round-trip through the same code that wrote it.
 *
 * The structural assertions below parse the bytes back independently, and the
 * last test hands the archive to an actual unzip implementation. Asserting
 * only "my parser reads what my writer wrote" would pass just as happily on a
 * mutually-consistent pair of bugs.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

async function bytesOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const entries: ZipEntry[] = [
  { path: "Source 1/01 First.jpg", bytes: enc("hello world") },
  { path: "Source 1/02 Second.png", bytes: enc("second payload") },
  { path: "Source 2/01 Other.jpg", bytes: enc("") }, // an empty file is legal
];

describe("ZIP structure", () => {
  it("starts with a local file header and ends with an EOCD", async () => {
    const view = await bytesOf(buildZip(entries));
    expect(view.getUint32(0, true)).toBe(LOCAL_SIG);
    // EOCD is the last 22 bytes when there is no archive comment.
    expect(view.getUint32(view.byteLength - 22, true)).toBe(EOCD_SIG);
  });

  it("records the right entry count in the EOCD, twice", async () => {
    const view = await bytesOf(buildZip(entries));
    const eocd = view.byteLength - 22;
    expect(view.getUint16(eocd + 8, true)).toBe(entries.length); // this disk
    expect(view.getUint16(eocd + 10, true)).toBe(entries.length); // total
  });

  it("points the EOCD at a central directory of the size it claims", async () => {
    const view = await bytesOf(buildZip(entries));
    const eocd = view.byteLength - 22;
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    expect(cdOffset + cdSize).toBe(eocd);
    expect(view.getUint32(cdOffset, true)).toBe(CENTRAL_SIG);
  });

  it("stores rather than compresses, with matching sizes", async () => {
    const view = await bytesOf(buildZip(entries));
    // Local header: method at +8, compressed at +18, uncompressed at +22.
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(18, true)).toBe(entries[0]!.bytes.length);
    expect(view.getUint32(22, true)).toBe(entries[0]!.bytes.length);
  });

  it("flags filenames as UTF-8 so non-ASCII titles survive", async () => {
    const view = await bytesOf(buildZip([{ path: "Sørce/Café ☕.jpg", bytes: enc("x") }]));
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    // The name length is the BYTE length of the UTF-8 encoding, not the JS
    // string length — getting that wrong shifts every following offset.
    expect(view.getUint16(26, true)).toBe(enc("Sørce/Café ☕.jpg").length);
  });

  it("computes a real CRC32", async () => {
    // "hello world" has a well-known CRC32. A stubbed or zeroed CRC is the
    // most likely silent bug here: many tools open such an archive anyway and
    // only complain on extraction.
    const view = await bytesOf(buildZip([{ path: "a.txt", bytes: enc("hello world") }]));
    expect(view.getUint32(14, true)).toBe(0x0d4a1185);
  });

  it("puts the central directory's local-header offsets where the headers are", async () => {
    const view = await bytesOf(buildZip(entries));
    const eocd = view.byteLength - 22;
    let p = view.getUint32(eocd + 16, true);
    for (let i = 0; i < entries.length; i++) {
      expect(view.getUint32(p, true)).toBe(CENTRAL_SIG);
      const nameLen = view.getUint16(p + 28, true);
      const offset = view.getUint32(p + 42, true);
      // Follow the pointer — a real local header must be sitting there.
      expect(view.getUint32(offset, true)).toBe(LOCAL_SIG);
      p += 46 + nameLen;
    }
  });
});

describe("entry naming", () => {
  it("strips characters Windows refuses, and numbers each entry", () => {
    expect(safeEntryName('a/b:c*d?e"f<g>h|i', 0, "jpg")).toBe("01 a b c d e f g h i.jpg");
  });

  it("falls back to a positional name when the title is empty", () => {
    expect(safeEntryName("   ", 4, "png")).toBe("05 Post 5.png");
  });

  it("never leaves a trailing dot or space, which Windows silently drops", () => {
    expect(safeEntryName("Report.  ", 0, "jpg")).toBe("01 Report.jpg");
  });

  it("reads the extension from the content type first, then the URL", () => {
    expect(extensionFor("https://x/a", "image/png")).toBe("png");
    expect(extensionFor("https://x/a.webp", null)).toBe("webp");
    expect(extensionFor("https://x/a.jpg?sig=1", null)).toBe("jpg");
    expect(extensionFor("https://x/no-extension", null)).toBe("jpg");
  });
});

/**
 * A reference ZIP containing one file, `ref.txt`, holding "reference".
 *
 * Produced by .NET's `System.IO.Compression` (PowerShell `Compress-Archive`)
 * — deliberately NOT by the writer under test. It is the capability probe: a
 * candidate command counts as a working ZIP reader only if it can list THIS
 * archive. Probing with an archive from `buildZip` would be circular, and
 * probing with `--version` is what produced the first false positive here —
 * GNU tar exists on PATH, answers `--version` happily, and cannot read ZIP at
 * all ("This does not look like a tar archive").
 */
const REFERENCE_ZIP_B64 =
  "UEsDBBQAAAAIAGouGV04LikKDgAAAAwAAAAHAAAAcmVmLnR4dHu/e39RalpqUWpecioAUEsBAhQAFAAAAAgAai4ZXTguKQoOAAAADAAAAAcAAAAAAAAAAAAAAAAAAAAAAHJlZi50eHRQSwUGAAAAAAEAAQA1AAAAMwAAAAAA";

/** The first command on this machine that genuinely reads ZIP, or null. */
function findZipReader(): { list: string[]; extract: string[] } | null {
  const candidates = [
    // libarchive tar — Windows 10+ System32, macOS, many Linux distros.
    { cmd: "bsdtar", list: ["-tf"], extract: ["-xf"] },
    { cmd: "tar", list: ["-tf"], extract: ["-xf"] },
    { cmd: "unzip", list: ["-l"], extract: ["-o"] },
  ];
  const dir = mkdtempSync(join(tmpdir(), "frenz-zipprobe-"));
  try {
    writeFileSync(join(dir, "ref.zip"), Buffer.from(REFERENCE_ZIP_B64, "base64"));
    for (const c of candidates) {
      try {
        const out = execFileSync(c.cmd, [...c.list, "ref.zip"], {
          cwd: dir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (out.includes("ref.txt")) {
          return { list: [c.cmd, ...c.list], extract: [c.cmd, ...c.extract] };
        }
      } catch {
        /* not this one */
      }
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("a real unzip accepts the archive", () => {
  /*
    Skipped rather than failed where no ZIP reader exists: a test that fails
    because a tool is missing teaches people to ignore it — the same rule the
    perf budget follows for a missing build manifest. Where a reader IS
    present (every dev machine and CI image checked), it runs.
  */
  const reader = findZipReader();

  it.skipIf(!reader)("extracts every entry with its bytes intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "frenz-zip-"));
    try {
      writeFileSync(join(dir, "batch.zip"), Buffer.from(await buildZip(entries).arrayBuffer()));

      /*
        Run FROM the temp dir with a RELATIVE filename. An absolute Windows
        path (`C:\Users\…`) is read by some tar builds as a remote `host:path`
        spec, which turns a local extraction into an attempted SSH connection
        to a host called "C". A relative name has no colon and no ambiguity on
        any platform.
      */
      const run = ([cmd, ...flags]: string[]) =>
        execFileSync(cmd!, [...flags, "batch.zip"], { cwd: dir, encoding: "utf8" });

      // Listing exercises the central directory; extraction exercises the
      // local headers AND verifies every CRC.
      const listed = run(reader!.list);
      for (const e of entries) expect(listed).toContain(e.path);

      run(reader!.extract);
      expect(readFileSync(join(dir, "Source 1", "01 First.jpg"), "utf8")).toBe("hello world");
      expect(readFileSync(join(dir, "Source 1", "02 Second.png"), "utf8")).toBe("second payload");
      expect(readFileSync(join(dir, "Source 2", "01 Other.jpg"), "utf8")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
