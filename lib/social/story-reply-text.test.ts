import { describe, expect, it } from "vitest";

import { STORY_REPLY_PREFIX, storyReplyText } from "./story-reply-text";

/** 2026-10-26 (owner: "story reply shouldn't show with emoji, it should show with professional premium icon"). */
describe("storyReplyText", () => {
  it("a new reply (no emoji) and an old one (↩️) both read as the reply alone", () => {
    expect(storyReplyText(`${STORY_REPLY_PREFIX}Nice`)).toBe("Nice");
    expect(storyReplyText("↩️ Replied to your story: Nice")).toBe("Nice");
  });
  it("a message marked story_reply without the prefix is still one", () => {
    expect(storyReplyText("Nice", { kind: "story_reply" })).toBe("Nice");
  });
  it("any other message is left alone", () => {
    expect(storyReplyText("Replied to your story")).toBeNull();
    expect(storyReplyText("hello")).toBeNull();
    expect(storyReplyText(null)).toBeNull();
  });
  it("the server no longer writes the emoji", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/api/stories/reply/route.ts", "utf8")).not.toContain("↩️");
  });
});
