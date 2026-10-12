import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const code = (p: string) => readFileSync(p, "utf8");

// owner, 2026-10-12: "when I hover on a media in chat, feed or anywhere, it shrinks the media
// inside the media container" + "lock media hover in feed and chat, they should use the option button"
describe("media lock — no iOS lift on feed or chat media", () => {
  it("inside a locked area the media element never takes the touch (dialogs keep native controls)", () => {
    const css = code("app/globals.css");
    expect(css).toContain('[data-media-lock] :is(img, video, picture, canvas):not([role="dialog"] *) {\n    pointer-events: none;');
    expect(css).toMatch(/\[data-media-lock\],\s*\[data-media-lock\] \* \{\s*-webkit-touch-callout: none;\s*-webkit-user-drag: none;/);
  });
  it("the feed card and the chat thread are locked", () => {
    expect(code("features/feed/feed-post-card.tsx")).toMatch(/<motion\.article\s+ref=\{articleRef\}[\s\S]{0,200}data-media-lock/);
    expect(code("features/social/conversation-room.tsx")).toMatch(/data-media-lock\s+className=\{cn\(\s+"frenz-thread-scroll/);
  });
  it("the feed video's FRAME takes the gestures; the <video> is untouchable", () => {
    const v = code("features/media/feed-video.tsx");
    const start = v.search(/<video\s+ref=\{video\}/);
    expect(start).toBeGreaterThan(0);
    const video = v.slice(start, v.indexOf("/>", start));
    expect(video).toContain("pointer-events-none");
    expect(video).not.toMatch(/onPointerDown|role="button"/);
    expect(v).toMatch(/ref=\{wrap\}[\s\S]{0,1200}role="button"[\s\S]{0,600}onPointerDown=/);
    // a press on play/pause or mute stays theirs
    expect(v).toContain('closest?.("button, a, [data-control]")');
  });
  it("a chat MEDIA bubble has no hold menu — its menu is the options button", () => {
    const c = code("features/social/conversation-room.tsx");
    expect(c).toContain("{...(canAct && !hasMediaAttachment ? holdBubble : {})}");
    expect(c).toMatch(/canAct && hasMediaAttachment \? \(\s*<button[\s\S]{0,120}aria-label="Message options"/);
  });
});

describe("SUB posts (owner, 2026-10-12)", () => {
  it("the tiled watermark says frenzsave.com, not Frenz", () => {
    const g = code("features/sub/sub-gallery.tsx");
    expect(g).toContain("{data.watermark} · frenzsave.com");
    expect(g).not.toContain("{data.watermark} · Frenz");
  });
  it("the viewer is full width", () => {
    expect(code("features/sub/sub-gallery.tsx")).toContain('width: "100cqw", height: `min(100cqh, calc(100cqw / ${ratio}))`');
  });
  it("saving a price shows Saving…, waits for the server, then refreshes the cached profile", () => {
    const t = code("features/sub/sub-tab.tsx");
    expect(t).toContain('{saving ? "Saving…" : "Save"}');
    expect(t).toMatch(/const r = await saveSettings\(\{ priceCents: cents \}\);[\s\S]{0,400}router\.refresh\(\);/);
  });
  it("the gallery's first page is shared with the tab warm-up and cached under the link lifetime", () => {
    const cache = code("features/sub/sub-posts-cache.ts");
    expect(cache).toContain("const FRESH_MS = 4 * 60_000;");
    expect(code("features/sub/sub-gallery.tsx")).toContain("loadSubPosts(creatorId)");
    expect(code("features/profile/profile-tabs.tsx")).toContain("onPointerDown={s.key === SUB_TAB_KEY ? () => void loadSubPosts(ownerId)");
  });
});
