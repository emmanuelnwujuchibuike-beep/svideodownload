import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { smartCategoryOf } from "@/lib/notifications/smart-category";

import { contentNoun, eligibleViewers } from "./creator-notify-emit";

/*
  Premium notification brief (2026-10-12) — "Notify me when Sarah posts" must never
  leak a post, reach someone blocked, or notify twice.
*/
const base = { publisherId: "pub", subscribers: ["a", "b", "c", "pub"], follows: new Set<string>(["a"]), excluded: new Set<string>() };

describe("who hears about a new post", () => {
  it("public → every subscriber except the publisher", () => {
    expect(eligibleViewers({ ...base, visibility: "public" })).toEqual(["a", "b", "c"]);
  });
  it("followers-only → only subscribers who follow the publisher", () => {
    expect(eligibleViewers({ ...base, visibility: "followers" })).toEqual(["a"]);
  });
  it("private → nobody, ever (a notification would leak that it exists)", () => {
    expect(eligibleViewers({ ...base, visibility: "private" })).toEqual([]);
  });
  it("blocked either way, muting, or already told → excluded (teeth)", () => {
    expect(eligibleViewers({ ...base, visibility: "public", excluded: new Set(["b"]) })).toEqual(["a", "c"]);
  });
});

describe("the publish pipeline's guards, in the real file", () => {
  const src = readFileSync("lib/social/creator-notify-emit.ts", "utf8");
  it("only a published, non-private, not-scheduled post fans out — checked against the row", () => {
    expect(src).toMatch(/p\.status !== "published" \|\| p\.visibility === "private"/);
    expect(src).toMatch(/p\.scheduled_at && Date\.parse\(p\.scheduled_at\) > Date\.now\(\)/);
  });
  it("is idempotent: anyone already told about this post is skipped", () => {
    expect(src).toMatch(/\.eq\("type", "news_following"\)\.eq\("post_id", postId\)/);
  });
  it("fails CLOSED: a failed privacy read throws instead of returning nobody-is-blocked", () => {
    expect(src).toMatch(/if \(error\) throw new Error\("read failed"\)/);
  });
  it("runs in after(), never as a bare fire-and-forget on the publish path", () => {
    expect(readFileSync("lib/social/posts.ts", "utf8")).toMatch(/after\(fanOut\)/);
    expect(readFileSync("app/api/stories/route.ts", "utf8")).toMatch(/after\(\(\) => notifyNewStory\(/);
  });
});

describe("words and tabs", () => {
  it("says what was shared", () => {
    expect(contentNoun({ media_kind: "video" })).toBe("a new reel");
    expect(contentNoun({ media_kind: "image", ai_job_id: "j" })).toBe("a new AI video");
    expect(contentNoun({ media_kind: "image" })).toBe("a new post");
  });
  it("smart tabs: messages, content, earnings, social — and everything else keeps a home", () => {
    expect(smartCategoryOf("message", "social")).toBe("messages");
    expect(smartCategoryOf("news_following", "news")).toBe("content");
    expect(smartCategoryOf("withdrawal_update", "premium")).toBe("earnings");
    expect(smartCategoryOf("like", "social")).toBe("social");
    expect(smartCategoryOf("security_login", "security")).toBe("security");
  });
});
