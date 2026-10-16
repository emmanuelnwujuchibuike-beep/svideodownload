import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildWatermarkArgs, markPlacement, outputSize, WATERMARK_MAX_SHORT_SIDE } from "./watermark-args";

/*
  Owner, 2026-10-15: "downloading with watermark shouldn't reduce quality below 720p if
  the media original quality is higher, if is 720p it shouldn't reduce any, same for
  480p. And it shouldn't be showing adding watermark when saving with watermark, is
  should show downloading. Downloading with watermark is taking too long, and it
  shouldn't be downloading like this, it should be downloading in the app like how
  without watermarks does."
*/
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const filterOf = (size: { width: number; height: number }) => {
  const args = buildWatermarkArgs("in", "mark.png", "out.mp4", size);
  return args[args.indexOf("-filter_complex") + 1]!;
};

describe("the watermarked video's size", () => {
  it("a source over 720p comes out at 720p on its shorter side — portrait, landscape and 4K", () => {
    expect(outputSize({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280, scaled: true });
    expect(outputSize({ width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720, scaled: true });
    expect(outputSize({ width: 2160, height: 3840 })).toEqual({ width: 720, height: 1280, scaled: true });
    const qhd = outputSize({ width: 1440, height: 2560 });
    expect(Math.min(qhd.width, qhd.height)).toBe(WATERMARK_MAX_SHORT_SIDE);
  });

  it("720p and 480p keep their own size — never reduced, never scaled up", () => {
    expect(outputSize({ width: 720, height: 1280 })).toEqual({ width: 720, height: 1280, scaled: false });
    expect(outputSize({ width: 480, height: 854 })).toEqual({ width: 480, height: 854, scaled: false });
    expect(outputSize({ width: 360, height: 640 })).toEqual({ width: 360, height: 640, scaled: false });
  });

  it("teeth: the filter scales only a source over 720p, and the mark is placed on the frame as encoded", () => {
    const big = filterOf({ width: 1080, height: 1920 });
    expect(big).toContain("[0:v]scale=720:1280:flags=lanczos[base];");
    expect(big).toContain("[base][wm]overlay=");
    expect(big).toContain(`scale=${markPlacement({ width: 720, height: 1280 }).width}:-2[wm]`);
    for (const size of [{ width: 720, height: 1280 }, { width: 480, height: 854 }]) {
      const f = filterOf(size);
      expect(f, `${size.width}x${size.height}`).not.toContain("[base]");
      expect(f).toContain("[0:v][wm]overlay=");
    }
  });

  it("an odd-sized source is evened (x264 needs it), keeping its resolution", () => {
    expect(outputSize({ width: 481, height: 855 })).toEqual({ width: 482, height: 856, scaled: true });
  });

  it("veryfast at the same quality — superfast made files 2.6× bigger, slower to download", () => {
    const args = buildWatermarkArgs("in", "mark.png", "out.mp4", { width: 720, height: 1280 });
    expect(args[args.indexOf("-preset") + 1]).toBe("veryfast");
    expect(args[args.indexOf("-crf") + 1]).toBe("21");
    expect(args).toContain("+faststart");
  });
});

describe("saving with the watermark looks like saving without it", () => {
  const post = src("lib/media/download-post.ts");
  const save = src("lib/media/save-to-device.ts");

  it("🔴 the toast says Downloading, never 'Adding watermark'", () => {
    expect(post).not.toContain("Adding watermark");
    expect(post).toContain('const tid = toast(downloadingLabel(null), "loading");');
  });

  it("🔴 on iOS a spent tap asks for one more tap in the app, instead of a Safari file page", () => {
    // the share sheet's NotAllowedError goes to the caller's prompt before the blob-link fallback
    const ask = save.indexOf('e.name === "NotAllowedError" && onNeedsTap');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(save.indexOf("// 2. Blob download"));
    expect(post).toContain("onNeedsTap: askTapToSave(tid),");
    expect(src("features/social/use-social-download.ts")).toContain("onNeedsTap: askTapToSave(crypto.randomUUID()),");
  });

  it("the label shows real progress only when the size is known", async () => {
    const { downloadingLabel } = await import("./download-label");
    expect(downloadingLabel(null)).toBe("Downloading…");
    expect(downloadingLabel(0.42)).toBe("Downloading… 42%");
    expect(downloadingLabel(1)).toBe("Downloading…");
    expect(downloadingLabel(0.5, { done: 1, total: 3 })).toBe("Downloading 2 of 3… 50%");
  });
});
