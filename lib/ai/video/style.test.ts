import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STYLE_WORDS, withStyle } from "@/lib/ai/video/style";

describe("the Video Style tiles only ever ADD words, and only when chosen", () => {
  it("no style → exactly the member's words (today's behaviour)", () => {
    expect(withStyle("  a cat on a roof  ", null, 2500)).toBe("a cat on a roof");
  });

  it("a style is appended, in plain words", () => {
    expect(withStyle("a cat on a roof", "anime", 2500)).toBe(`a cat on a roof. ${STYLE_WORDS.anime}.`);
  });

  it("an empty prompt stays empty — a style alone is not a description", () => {
    expect(withStyle("   ", "realistic", 2500)).toBe("");
  });

  it("…except where the prompt is optional (Image to Video): the style alone is sent", () => {
    expect(withStyle("", "anime", 2500, { standalone: true })).toBe("Anime style.");
    expect(withStyle("", null, 2500, { standalone: true })).toBe("");
  });

  it("never exceeds the model's limit; the style survives, the member's words are trimmed", () => {
    const out = withStyle("x".repeat(2500), "cartoon", 2500);
    expect(out.length).toBeLessThanOrEqual(2500);
    expect(out.endsWith(`${STYLE_WORDS.cartoon}.`)).toBe(true);
  });

  it("every style picture the workspace names exists, and is a small file", () => {
    const ws = readFileSync(join(process.cwd(), "features/ai/video/video-styles.ts"), "utf8");
    const images = [...ws.matchAll(/image: "(\/ai\/styles\/[a-z0-9-]+\.webp)"/g)].map((m) => m[1]!);
    expect(images).toHaveLength(4);
    for (const src of images) {
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), src).toBe(true);
      // a tile is ~132 px wide; anything near a photo's size means the resize was skipped
      expect(statSync(file).size, src).toBeLessThan(20_000);
    }
  });

  it("the workspace starts with NO style chosen", () => {
    const ws = readFileSync(join(process.cwd(), "features/ai/video/text-to-video-workspace.tsx"), "utf8");
    expect(ws).toContain("const [style, setStyle] = useState<VideoStyle | null>(null);");
    expect(ws).toContain("prompt: withStyle(prompt, style, KLING_OMNI.prompt.maxChars),");
  });
});
