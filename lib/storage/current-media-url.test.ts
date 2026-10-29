import { describe, expect, it } from "vitest";

import { currentMediaUrl } from "./current-media-url";

const BASE = "https://media.frenzsave.com";

describe("currentMediaUrl — old chat media served from today's media domain", () => {
  it("an r2.dev voice note is the same key on the media domain", () => {
    expect(currentMediaUrl("https://pub-0a1b2c.r2.dev/post-media/u1/voice.m4a", BASE)).toBe(`${BASE}/post-media/u1/voice.m4a`);
  });
  it("a link already on the media domain, a Supabase file or an outside link is left alone", () => {
    for (const u of [`${BASE}/post-media/u1/a.m4a`, "https://x.supabase.co/storage/v1/object/public/post-media/a.webm", "https://example.com/a.mp3"]) {
      expect(currentMediaUrl(u, BASE)).toBe(u);
    }
  });
  it("nothing to move to: still serving from r2.dev, or no base set (teeth: never rewrite onto a dead host)", () => {
    const old = "https://pub-0a1b2c.r2.dev/k.m4a";
    expect(currentMediaUrl(old, "https://pub-0a1b2c.r2.dev")).toBe(old);
    expect(currentMediaUrl(old, undefined)).toBe(old);
    expect(currentMediaUrl(null, BASE)).toBeNull();
  });
});
