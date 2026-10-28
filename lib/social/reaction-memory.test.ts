import { describe, expect, it } from "vitest";

import { rememberedReaction, rememberReaction } from "./reaction-memory";

describe("the viewer's reactions this session", () => {
  it("🔴 a like survives a card re-mounting from a stale cached page (2026-10-28)", () => {
    rememberReaction("p1", { liked: true, likes: 4 });
    rememberReaction("p1", { emotion: "fire" });
    expect(rememberedReaction("p1")).toEqual({ liked: true, likes: 4, emotion: "fire" });
    expect(rememberedReaction("p2")).toBeUndefined();
  });
});
