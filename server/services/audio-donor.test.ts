import { describe, expect, it } from "vitest";

import type { MediaFormat } from "@/types";

import { audioDonorCandidates, audioMuxInputArgs, donorAudioArgs, hevcDelivery, muxVideoArgs } from "./audio-donor";

/**
 * vt.tiktok.com/ZSg7YNcy3 (owner, 2026-10-30: "some tiktok video doesn't download with sound"), measured: TikTok's
 * adapt_lowest_1080_1 / adapt_lower_720_1 / adapt_540_1 tiers are VIDEO ONLY; normal_720_0 and playAddr carry the
 * audio. These read the order the sound is looked for in and the exact command that lays it under the picture.
 */
const f = (formatId: string, over: Partial<MediaFormat>): MediaFormat =>
  ({ formatId, kind: "video", ext: "mp4", label: formatId, resolution: null, fps: null, filesize: null, tbr: null, vcodec: null, acodec: null, ...over }) as MediaFormat;

const adapt1080 = f("tt-0", { vcodec: "hevc", directUrl: "https://cdn/adapt1080" });
const normal720 = f("tt-1", { vcodec: "h264", directUrl: "https://cdn/normal720" });
const adapt540 = f("tt-2", { vcodec: "hevc", directUrl: "https://cdn/adapt540" });
const ladder480 = f("tt-1-h480", { vcodec: "h264", directUrl: "https://cdn/normal720", transcodeMaxHeight: 480 });
const music = f("audio", { kind: "audio", ext: "m4a", vcodec: null, directUrl: "https://cdn/music" });

describe("where a silent tier's sound comes from", () => {
  it("a sibling H.264 tier first (the one TikTok muxes), then other tiers, the music last — never itself", () => {
    const order = audioDonorCandidates([adapt1080, normal720, adapt540, ladder480, music], adapt1080).map((x) => x.formatId);
    expect(order).toEqual(["tt-1", "tt-2", "audio"]);
  });

  it("teeth: the post's MUSIC is never preferred over a sibling tier (for a reel using a song it is the song alone)", () => {
    const order = audioDonorCandidates([music, adapt540, normal720], adapt1080).map((x) => x.formatId);
    expect(order.indexOf("audio")).toBeGreaterThan(order.indexOf("tt-1"));
    expect(order.at(-1)).toBe("audio");
  });

  it("a synthesized tier is never a donor (it is a re-encode of another tier, not a source)", () => {
    expect(audioDonorCandidates([ladder480, music], adapt1080).map((x) => x.formatId)).toEqual(["audio"]);
  });
});

describe("the command", () => {
  const args = audioMuxInputArgs({ url: "https://cdn/adapt1080", headerArgs: ["-headers", "Cookie: a=1"] }, { url: "https://cdn/normal720", headerArgs: ["-headers", "Cookie: a=1"] }, "2");

  it("the picture from the chosen file, the sound from the donor — never the chosen file's (absent) audio", () => {
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args[args.indexOf("-i") + 1]).toBe("https://cdn/adapt1080");
    expect(args[args.lastIndexOf("-i") + 1]).toBe("https://cdn/normal720");
    const maps = args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []));
    expect(maps).toEqual(["0:v:0", "1:a:0"]);
    // teeth: the old optional map of input 0's audio is exactly what produced the silent file
    expect(args).not.toContain("0:a:0?");
    expect(args).toContain("-shortest");
  });

  it("each input carries its own headers (TikTok's CDN wants the page cookie on both)", () => {
    expect(args.indexOf("-headers")).toBeLessThan(args.indexOf("-i"));
    expect(args.lastIndexOf("-headers")).toBeGreaterThan(args.indexOf("-i"));
    expect(args.lastIndexOf("-headers")).toBeLessThan(args.lastIndexOf("-i"));
  });

  it("an iPhone keeps the HEVC picture untouched (tagged hvc1); other devices get H.264; H.264 is always copied", () => {
    expect(muxVideoArgs("hevc", true, "2")).toEqual(["-c:v", "copy", "-tag:v", "hvc1"]);
    expect(muxVideoArgs("hevc", false, "2")).toContain("libx264");
    expect(muxVideoArgs("h264", false, "2")).toEqual(["-c:v", "copy"]);
    // teeth: a codec the phone can't play is never copied just because the device plays HEVC
    expect(muxVideoArgs("vp9", true, "2")).toContain("libx264");
  });

  it("the donor's HE-AAC becomes AAC-LC (gallery players mangle HE-AAC); plain AAC is copied; anything else converted", () => {
    expect(donorAudioArgs({ audio: "aac", audioProfile: "HE-AACv2" })).toEqual(["-c:a", "aac", "-b:a", "128k"]);
    expect(donorAudioArgs({ audio: "aac", audioProfile: "LC" })).toEqual(["-c:a", "copy"]);
    expect(donorAudioArgs({ audio: "mp3", audioProfile: null })).toEqual(["-c:a", "aac", "-b:a", "192k"]);
  });
  it("a device that plays HEVC never gets its picture re-encoded: raw, or only the HE-AAC sound converted", () => {
    // TikTok's Best tier, measured: HEVC + HE-AACv2 — was a whole re-encode (9.5 s to the first byte), now a copy
    expect(hevcDelivery(true, "hevc", true)).toBe("copyPicture");
    expect(hevcDelivery(true, "hevc", false)).toBe("raw");
    // teeth: a device that does NOT claim HEVC still gets the compatibility path, and non-HEVC is never this case
    expect(hevcDelivery(false, "hevc", true)).toBeNull();
    expect(hevcDelivery(true, "vp9", true)).toBeNull();
    expect(hevcDelivery(true, null, false)).toBeNull();
  });
});
