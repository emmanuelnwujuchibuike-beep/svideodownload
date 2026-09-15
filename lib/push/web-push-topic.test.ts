import { describe, expect, it } from "vitest";

import { webPushTopic } from "./web-push";

/**
 * Apple's Web Push Topic header must be valid base64url of at most 32
 * characters. A base64url string can never have length ≡ 1 (mod 4) — and
 * "frenz-ai-done" (13) was exactly that, so every "your video is ready" push
 * to an iPhone came back 400 BadWebPushTopic (2026-09-15).
 */
describe("webPushTopic", () => {
  const TAGS = ["frenz-ai-done", "frenz-ai-failed", "download-outcome", "streak-lost", "signin", "ai-clean-failed", "like:4ac9a444-9ae5-4b6c-966b-da30702ea24d", "msg:edaf9330-9267-40e4-8cb7-9efe5381bc18"];
  it("is valid base64url, never longer than 32, never a length Apple refuses", () => {
    for (const tag of TAGS) {
      const t = webPushTopic(tag);
      expect(t, tag).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.length, tag).toBeLessThanOrEqual(32);
      expect(t.length % 4, tag).not.toBe(1);
    }
  });
  it("is stable for the same tag (collapsing still works) and distinct across tags", () => {
    expect(webPushTopic("frenz-ai-done")).toBe(webPushTopic("frenz-ai-done"));
    expect(new Set(TAGS.map(webPushTopic)).size).toBe(TAGS.length);
  });
  it("the failing tag itself now encodes to a legal topic", () => {
    const t = webPushTopic("frenz-ai-done");
    expect(Buffer.from(t, "base64url").toString("utf8")).toBe("frenz-ai-done");
    expect(t.length % 4).not.toBe(1);
  });
});
