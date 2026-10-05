import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withoutPrompt } from "@/features/ai/video/use-video-generation";

/**
 * Brief B §15 (2026-10-05): re-quote when a PRICED setting changes, never per
 * keystroke. The pipelines price duration, resolution, audio and references —
 * not the prompt — so typing must not reach /api/ai/video/quote.
 */
describe("the video quote is asked again only when the price can change", () => {
  it("the priced view of an input drops the prompt and keeps every priced field", () => {
    const input = { prompt: "a cat", referenceImageUrls: ["u"], options: { durationSeconds: 5, resolution: "720p", audio: "off" } };
    expect(withoutPrompt(input)).toEqual({ referenceImageUrls: ["u"], options: { durationSeconds: 5, resolution: "720p", audio: "off" } });
    // two prompts, same settings → the same trigger key
    expect(JSON.stringify(withoutPrompt({ ...input, prompt: "a dog" }))).toBe(JSON.stringify(withoutPrompt(input)));
    // a priced change → a different key
    expect(JSON.stringify(withoutPrompt({ ...input, options: { ...input.options, durationSeconds: 10 } }))).not.toBe(
      JSON.stringify(withoutPrompt(input)),
    );
  });

  it("the quote effect is keyed on the priced view, not on the whole input", () => {
    const hook = readFileSync(join(process.cwd(), "features/ai/video/use-video-generation.ts"), "utf8");
    expect(hook).toContain("}, [feature, pricedKey, ready]);");
    expect(hook).not.toContain("}, [feature, input, ready]);");
  });

  it("the pipelines really do price without the prompt — the premise above", () => {
    for (const f of ["lib/ai/kling/pipelines/text-to-video.ts", "lib/ai/kling/pipelines/image-to-video.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const quote = src.slice(src.indexOf("quote(input"), src.indexOf("quote(input") + 1600);
      expect(quote.length, f).toBeGreaterThan(100);
      expect(quote, f).not.toContain("input.prompt");
    }
  });
});
