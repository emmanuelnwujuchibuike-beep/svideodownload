import { describe, expect, it } from "vitest";

import { giftCommentId, giftCommentUuid } from "./comment-gifts";

const G = "0b8f2c7e-1d3a-4f5b-9c6d-7e8f9a0b1c2d";

describe("gift comments (0304): gf:<gift id>", () => {
  it("round-trips a gift id, and fits the comment sticker column (40 characters)", () => {
    expect(giftCommentUuid(giftCommentId(G))).toBe(G);
    expect(giftCommentId(G).length).toBeLessThanOrEqual(40);
  });
  it("reads nothing else as a gift — an emoji sticker, a video sticker, a bad id", () => {
    for (const s of ["fire", `vs:${G}`, "gf:not-a-uuid", `gf:${G}x`, "", null, undefined]) expect(giftCommentUuid(s)).toBeNull();
  });
});
