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

describe("Private posts (owner, 2026-10-12)", () => {
  it("the viewer watermark says frenzsave.com, not Frenz", () => {
    const g = code("features/sub/sub-gallery.tsx");
    expect(g).toContain("{data.watermark} · frenzsave.com");
    expect(g).not.toContain("{data.watermark} · Frenz");
  });
  it("the viewer is full width: each slide is the whole stage, the media fills it unless its measured shape is truly different", () => {
    const g = code("features/sub/sub-gallery.tsx");
    expect(g).toContain('<div key={i} className="relative h-full w-full shrink-0 snap-center overflow-hidden">');
    expect(g).toContain("Math.abs(r - stageRatio) / stageRatio <= 0.28");
    expect(g).toContain("onLoadedMetadata={(e) => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}");
    // teeth: the letterboxing container-query box is gone
    expect(g).not.toContain("[container-type:size]");
  });
  it("older video posts get a preview from the creator's own browser, once", () => {
    const g = code("features/sub/sub-gallery.tsx");
    expect(g).toContain("if (!state?.isCreator || backfilling.current) return;");
    expect(code("app/api/sub/posts/[id]/route.ts")).toMatch(/export async function PATCH[\s\S]*\.is\("thumb_key", null\)/);
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

// owner, 2026-10-12: "medias should never shrink or expand when tapped"
describe("a feed video never changes size", () => {
  it("always fills its frame, and a stored shape is never replaced by the measured one", () => {
    const v = code("features/media/feed-video.tsx");
    expect(v).not.toContain("setFills");
    expect(v).not.toMatch(/fills \? "object-cover" : "object-contain"/);
    expect(v).toContain("setRatio((cur) => cur ?? clampRatio(v.videoWidth, v.videoHeight));");
  });
  it("no hover growth on the feed card", () => {
    expect(code("features/feed/feed-post-card.tsx")).not.toContain("group-hover:scale-105");
  });
});

// owner, 2026-10-12: "it shouldn't prefetch ad with the download fetch time … and the ad slot on the result card is too close to the quality picker"
describe("no ad loads while a link or a file is downloading", () => {
  it("the completion creative is warmed while choosing a quality, never on the Download tap", () => {
    const p = code("features/downloader/preview-card.tsx");
    expect(p).not.toContain("warmCompletionCreative();");
    expect(p).toContain("downloadStarted.current = true;");
    expect(p).toMatch(/if \(downloadStarted\.current\) return;[\s\S]{0,200}warmCreativeFor\("download-complete"\)/);
  });
  it("the preparing ad mounts only when idle and never during a fetch", () => {
    const a = code("features/monetization/preparing-ad.tsx");
    expect(a).toContain("useEffect(() => afterPageLoad(() => setIdle(true)), []);");
    expect(a).toContain("if (idle && !active) setMounted(true);");
    expect(a).toContain("if (!mounted) return null;");
  });
  it("the result card ad keeps its distance from the quality picker", () => {
    const r = code("features/monetization/result-ad.tsx");
    expect(r).toContain('data-ad-provider="frenzsave" className={cn("mt-8", className)}');
    expect(r).toContain('"mx-auto mt-8 w-full max-w-2xl"');
  });
});

// owner, 2026-10-12: "sub post still takes ages to show the cover … cover should load instantly"
describe("SUB tiles load a small preview, not the original", () => {
  it("the composer makes and uploads a ~480 px preview beside each file", () => {
    const c = code("features/sub/sub-composer.tsx");
    expect(c).toContain("const thumb = await makeThumb(it.file);");
    expect(code("lib/media/make-thumb.ts")).toContain("export const THUMB_EDGE = 480;");
  });
  it("the server only accepts a preview from the creator's own folder, signs it for those with access, and deletes it with the post", () => {
    const p = code("lib/sub/posts.ts");
    expect(p).toMatch(/m\.thumbKey && \(!m\.thumbKey\.startsWith\(prefix\)/);
    expect(p).toContain("firstThumb ? presignPrivateGet(firstThumb, SIGNED_TTL_SECONDS)");
    expect(p).toContain("[m.object_key, m.thumb_key]");
    expect(p).toContain("if (opening && isCreator) {");
  });
  it("cover first: a tile shows the cover or preview and never loads the original media", () => {
    const g = code("features/sub/sub-gallery.tsx");
    expect(g).toContain("p.thumbUrl ? (");
    expect(g).not.toContain("src={p.open.media[0].url}");
    expect(g).not.toContain("p.open.media[0].url}#t=0.1");
    // the first post's first photo is pre-loaded only once the browser is idle
    expect(g).toContain("window.requestIdleCallback(go, { timeout: 2500 })");
  });
});

// owner, 2026-10-12: Discover video tiles showed the browser's "?" instead of a thumbnail
describe("no broken-image glyph, no moving media in discovery", () => {
  it("the Discover people tile falls back instead of showing '?'", () => {
    const d = code("features/friends/nearby-discovery.tsx");
    expect(d).toContain("<SmartThumb");
    expect(d).not.toContain("group-hover:scale-105");
  });
  it("a search card holding media never shrinks on press", () => {
    expect(code("app/globals.css")).toContain(".srch-press:not(:has(img, video, picture, canvas)):active {");
  });
});

// owner, 2026-10-12: "the ad rotation is not equal … make the rotation equal" (video 60 views vs image 692 in one slot)
describe("ads in one slot rotate equally", () => {
  it("a video ad is not banned by its own cleanup", () => {
    const c = code("features/ads-platform/serve/self-ad-creative.tsx");
    expect(c).toContain("if (unmounting.current) return;");
    expect(c).toMatch(/unmounting\.current = true;[\s\S]{0,300}v\.removeAttribute\("src"\);/);
    expect(c).toContain("unmounting.current = false;");
  });
});
