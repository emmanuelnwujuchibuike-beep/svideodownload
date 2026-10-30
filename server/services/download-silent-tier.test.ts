import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * resolveDownload, driven for real with ffmpeg, the metadata and the file cache stubbed — the shape TikTok served for
 * vt.tiktok.com/ZSg7YNcy3 on 2026-10-30 (owner: "some tiktok video doesn't download with sound"): the tallest tiers are
 * video-only adaptive streams, the 720p H.264 tier carries the audio. The probe answers come from ffmpeg's own
 * "Video:" / "Audio:" lines, exactly as runCodecProbe reads them.
 */
const PROBE: Record<string, string> = {
  "https://cdn/adapt1080": "  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080",
  "https://cdn/adapt540": "  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1024x576",
  "https://cdn/normal720":
    "  Stream #0:0[0x1](und): Audio: aac (HE-AACv2) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 32 kb/s\n  Stream #0:1[0x2](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv), 1280x720",
  "https://cdn/silent-only": "  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080",
};

const encodes: string[][] = [];
const spawn = vi.fn((_bin: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
  const isProbe = !args.includes("-map");
  if (!isProbe) encodes.push(args);
  setTimeout(() => {
    if (isProbe) child.stderr.emit("data", Buffer.from(PROBE[args.at(-1)!] ?? ""));
    child.emit("close", 0);
  }, 0);
  return child;
});
vi.mock("node:child_process", () => ({ spawn }));

const fmt = (formatId: string, over: Record<string, unknown>) => ({ formatId, kind: "video", ext: "mp4", label: formatId, resolution: null, fps: null, filesize: null, tbr: null, vcodec: null, acodec: "aac", httpHeaders: { Cookie: "tt_chain_token=x" }, ...over });
let meta: { platform: string; title: string; formats: ReturnType<typeof fmt>[] };
vi.mock("@/server/extractors", () => ({ getCachedMetadata: async () => meta, getMetadata: async () => meta }));
vi.mock("./download-cache", () => ({
  getOrProduce: async (_key: string, ext: string, contentType: string, produce: (p: string) => Promise<void>) => {
    await produce("/tmp/out.mp4");
    return { stream: new ReadableStream(), ext, contentType, filesize: 1 };
  },
}));
vi.mock("./telegram-mtproto", () => ({ downloadTelegramStream: vi.fn(), downloadTelegramMedia: vi.fn() }));
vi.mock("./ytdlp-service", () => ({
  prepareDownload: vi.fn(async () => {
    throw new Error("yt-dlp not reached");
  }),
  YtDlpError: class YtDlpError extends Error {},
}));

const maps = (args: string[]) => args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []));
const inputs = (args: string[]) => args.flatMap((a, i) => (a === "-i" ? [args[i + 1]] : []));

beforeEach(() => {
  encodes.length = 0;
  meta = {
    platform: "tiktok",
    title: "Barcelona Steal Kane's Ballon d'Or Part 2",
    formats: [
      fmt("tt-0", { vcodec: "hevc", directUrl: "https://cdn/adapt1080" }),
      fmt("tt-1", { vcodec: "h264", directUrl: "https://cdn/normal720" }),
      fmt("tt-2", { vcodec: "hevc", directUrl: "https://cdn/adapt540" }),
      fmt("tt-2-h360", { vcodec: "hevc", directUrl: "https://cdn/adapt540", transcodeMaxHeight: 360 }),
    ],
  };
});

describe("🔴 a video-only tier downloads WITH the post's sound", () => {
  it("iPhone, Best quality (the silent 1080p HEVC tier): HEVC copied untouched + the 720p tier's audio as AAC-LC", async () => {
    const { resolveDownload } = await import("./download-service");
    await resolveDownload("https://vt.tiktok.com/ZSg7YNcy3/", "tt-0", "video", "v", { clientPlaysHevc: true });
    expect(encodes).toHaveLength(1);
    const args = encodes[0]!;
    expect(inputs(args)).toEqual(["https://cdn/adapt1080", "https://cdn/normal720"]);
    expect(maps(args)).toEqual(["0:v:0", "1:a:0"]);
    expect(args.join(" ")).toContain("-c:v copy -tag:v hvc1");
    expect(args.join(" ")).toContain("-c:a aac -b:a 128k");
  }, 20_000);

  // owner, 2026-10-30: "Send the original HEVC to everyone … I need faster and full quality" (HEVC_TO_EVERY_DEVICE)
  it("a device whose browser does not claim HEVC: the same sound, and STILL the original picture — never re-encoded", async () => {
    const { resolveDownload } = await import("./download-service");
    await resolveDownload("https://vt.tiktok.com/ZSg7YNcy3/", "tt-0", "video", "v", {});
    const args = encodes[0]!;
    expect(maps(args)).toEqual(["0:v:0", "1:a:0"]);
    expect(args.join(" ")).toContain("-c:v copy -tag:v hvc1");
    expect(args).not.toContain("libx264");
  });

  it("a smaller tier made from a silent rendition gets the sound too", async () => {
    const { resolveDownload } = await import("./download-service");
    await resolveDownload("https://vt.tiktok.com/ZSg7YNcy3/", "tt-2-h360", "video", "v", {});
    const args = encodes[0]!;
    expect(inputs(args)).toEqual(["https://cdn/adapt540", "https://cdn/normal720"]);
    expect(maps(args)).toEqual(["0:v:0", "1:a:0"]);
    expect(args.join(" ")).toContain("scale=-2:min(360");
  });

  it("teeth: a tier that HAS audio keeps its own — one input, its own optional audio map, no donor", async () => {
    const { resolveDownload } = await import("./download-service");
    await resolveDownload("https://vt.tiktok.com/ZSg7YNcy3/", "tt-1", "video", "v", {});
    // H.264 + HE-AAC → the remux that re-encodes only the audio, from the SAME file
    const args = encodes[0]!;
    expect(inputs(args)).toEqual(["https://cdn/normal720"]);
    expect(maps(args)).toEqual(["0:v:0", "0:a:0?"]);
  });

  it("a post with no audio anywhere still delivers its picture (as before) — never a failure", async () => {
    meta.formats = [fmt("tt-0", { vcodec: "hevc", directUrl: "https://cdn/silent-only" })];
    const { resolveDownload } = await import("./download-service");
    await resolveDownload("https://vt.tiktok.com/x/", "tt-0", "video", "v", {});
    expect(inputs(encodes[0]!)).toEqual(["https://cdn/silent-only"]);
  });
});
