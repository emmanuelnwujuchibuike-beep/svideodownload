import { describe, expect, it } from "vitest";

import {
  ALLOWED_DESTINATIONS,
  RESHARE_DESTINATIONS,
  canReshareTo,
  isValidReelMedia,
  type ReshareDestination,
} from "./reshare-rules";

/**
 * These pin the owner's reshare rule (2026-07-16), which is a PRIVACY promise,
 * not a preference: a friend's story may go "to their own stories or private
 * chat no where else". A regression here would quietly publish someone's story
 * to a public feed — exactly the kind of thing that can't be caught by looking
 * at a screenshot, so it's pinned here instead.
 */
describe("reshare destination rules", () => {
  it("lets chat media go to the feed, Reels and a story", () => {
    expect(canReshareTo("message", "post")).toBe(true);
    expect(canReshareTo("message", "reel")).toBe(true);
    expect(canReshareTo("message", "story")).toBe(true);
  });

  it("NEVER lets a story reach the feed or Reels", () => {
    expect(canReshareTo("story", "post")).toBe(false);
    expect(canReshareTo("story", "reel")).toBe(false);
  });

  it("lets a story go only to your own story or a private chat", () => {
    expect(canReshareTo("story", "story")).toBe(true);
    expect(canReshareTo("story", "chat")).toBe(true);
    // Exhaustive: anything not explicitly allowed above must be refused.
    const allowed = new Set<ReshareDestination>(ALLOWED_DESTINATIONS.story);
    for (const d of RESHARE_DESTINATIONS) {
      expect(canReshareTo("story", d)).toBe(allowed.has(d));
    }
    expect([...allowed].sort()).toEqual(["chat", "story"]);
  });

  it("does not route chat media into another chat (forwarding owns that)", () => {
    expect(canReshareTo("message", "chat")).toBe(false);
  });

  it("only allows a video to become a Reel", () => {
    expect(isValidReelMedia("video")).toBe(true);
    expect(isValidReelMedia("image")).toBe(false);
  });

  it("keeps every declared destination inside the known set", () => {
    for (const source of ["message", "story"] as const) {
      for (const d of ALLOWED_DESTINATIONS[source]) {
        expect(RESHARE_DESTINATIONS).toContain(d);
      }
    }
  });
});
