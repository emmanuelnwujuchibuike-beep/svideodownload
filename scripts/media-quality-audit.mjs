/**
 * MEASURE what a file actually is — the diagnostic behind any "downloads are
 * lower quality than the original" claim.
 *
 * Compares two media files (or URLs) field by field: size, dimensions, codec,
 * bitrate, frame rate, audio codec/bitrate/sample rate, pixel format, duration.
 * Anything that differs is printed as a DELTA, so a degradation is a number
 * rather than an impression.
 *
 *   node scripts/media-quality-audit.mjs <original> <downloaded>
 *   node scripts/media-quality-audit.mjs https://…/orig.mp4 ./saved.mp4
 *
 * A single argument just reports that one file:
 *   node scripts/media-quality-audit.mjs ./saved.mp4
 *
 * Needs ffprobe on PATH (FFMPEG_PATH's sibling, or set FFPROBE_PATH). Images
 * are measured without it — the header is parsed directly — so image checks
 * work on a machine with no ffmpeg at all.
 */
import { spawn } from "node:child_process";
import { readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/* ── image headers, no dependencies ─────────────────────────────────────────
   Deliberately not `sharp`: this has to run anywhere, and reading the SOF/IHDR
   is a few lines. Same reasoning as lib/media/image-size.ts. */
export function imageInfo(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, excluding DHT(c4) DAC(cc) and the RSTn markers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { format: "jpeg", width: null, height: null };
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { format: "webp", width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (chunk === "VP8 ") return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { format: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    return { format: "webp", width: null, height: null };
  }
  if (buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp") return null; // video container
  return null;
}

function ffprobe(target) {
  return new Promise((resolve) => {
    const child = spawn(
      FFPROBE,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", target],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try { resolve(JSON.parse(out)); } catch { resolve({ __error: err.slice(-200) }); }
    });
  });
}

async function localCopyOf(target) {
  if (!/^https?:\/\//i.test(target)) return { path: target, bytes: await readFile(target) };
  const res = await fetch(target, { redirect: "follow" });
  if (!res.ok) throw new Error(`${target} responded ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "mqa-"));
  const path = join(dir, "media" + (target.match(/\.[a-z0-9]{2,4}(?=($|\?))/i)?.[0] ?? ""));
  await writeFile(path, bytes);
  return { path, bytes, contentType: res.headers.get("content-type"), contentLength: res.headers.get("content-length") };
}

export async function describe(target) {
  const { path, bytes, contentType, contentLength } = await localCopyOf(target);
  const size = bytes.length;
  const img = imageInfo(bytes);
  if (img) {
    return {
      target, kindGuess: "image", bytes: size, contentType, contentLength,
      format: img.format, width: img.width, height: img.height,
    };
  }
  const probe = await ffprobe(path);
  if (!probe || probe.__error) {
    return { target, kindGuess: "unknown", bytes: size, contentType, note: probe?.__error ?? "ffprobe unavailable" };
  }
  const v = (probe.streams ?? []).find((s) => s.codec_type === "video");
  const a = (probe.streams ?? []).find((s) => s.codec_type === "audio");
  // ffprobe reports frame rate as the rational "30000/1001". Parsed, never
  // eval'd — this string comes from a file the user supplied.
  const fps = (() => {
    const [num, den] = String(v?.avg_frame_rate ?? "").split("/").map(Number);
    if (!num || !den) return null;
    return Number((num / den).toFixed(3));
  })();
  return {
    target, kindGuess: v ? "video" : a ? "audio" : "unknown", bytes: size, contentType, contentLength,
    container: probe.format?.format_name ?? null,
    durationSec: probe.format?.duration ? Number(Number(probe.format.duration).toFixed(2)) : null,
    totalBitrateKbps: probe.format?.bit_rate ? Math.round(Number(probe.format.bit_rate) / 1000) : null,
    vcodec: v?.codec_name ?? null,
    profile: v?.profile ?? null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps,
    pixFmt: v?.pix_fmt ?? null,
    videoBitrateKbps: v?.bit_rate ? Math.round(Number(v.bit_rate) / 1000) : null,
    acodec: a?.codec_name ?? null,
    audioBitrateKbps: a?.bit_rate ? Math.round(Number(a.bit_rate) / 1000) : null,
    audioSampleRate: a?.sample_rate ? Number(a.sample_rate) : null,
    audioChannels: a?.channels ?? null,
  };
}

const WORSE_WHEN_LOWER = new Set([
  "bytes", "width", "height", "fps", "totalBitrateKbps", "videoBitrateKbps",
  "audioBitrateKbps", "audioSampleRate", "audioChannels",
]);

export function compare(original, downloaded) {
  const keys = [...new Set([...Object.keys(original), ...Object.keys(downloaded)])].filter((k) => k !== "target");
  const rows = [];
  for (const k of keys) {
    const a = original[k];
    const b = downloaded[k];
    if (a === b || (a == null && b == null)) continue;
    let verdict = "changed";
    if (typeof a === "number" && typeof b === "number" && WORSE_WHEN_LOWER.has(k)) {
      const pct = a === 0 ? 0 : Math.round(((b - a) / a) * 100);
      verdict = b < a ? `DEGRADED ${pct}%` : `higher +${pct}%`;
    }
    rows.push({ field: k, original: a ?? null, downloaded: b ?? null, verdict });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("media-quality-audit.mjs")) {
  const [a, b] = process.argv.slice(2);
  if (!a) {
    console.error("usage: node scripts/media-quality-audit.mjs <original> [downloaded]");
    process.exit(1);
  }
  const first = await describe(a);
  if (!b) {
    console.log(JSON.stringify(first, null, 2));
  } else {
    const second = await describe(b);
    console.log("ORIGINAL  ", JSON.stringify(first, null, 2));
    console.log("\nDOWNLOADED", JSON.stringify(second, null, 2));
    const rows = compare(first, second);
    console.log("\n─── DELTAS ───");
    if (rows.length === 0) console.log("  identical on every measured field — the pipeline is a passthrough");
    for (const r of rows) console.log(`  ${r.field.padEnd(20)} ${String(r.original).padEnd(18)} -> ${String(r.downloaded).padEnd(18)} ${r.verdict}`);
    const degraded = rows.filter((r) => String(r.verdict).startsWith("DEGRADED"));
    console.log(`\n${degraded.length ? "❌ " + degraded.length + " field(s) degraded" : "✅ nothing degraded"}`);
  }
}
