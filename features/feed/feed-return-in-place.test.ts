import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-31: the stories / Continue Watching section "reloads on every navigation" back to the Feed, and "going
  back to for you from following reloads the whole feed page take the feed page down even if I didn't scroll".
*/
const feed = readFileSync("features/feed/smart-feed.tsx", "utf8");
const rings = readFileSync("features/app-shell/dashboard/stories-row.tsx", "utf8");
const watching = readFileSync("features/app-shell/dashboard/continue-watching.tsx", "utf8");

const tabComesBackInPlace = (src: string) => /const cached = cacheRef\.current!\[s\];\s*if \(cached\) \{[\s\S]{0,700}?setInstant\(true\);\s*setItems\(cached\.items\);/.test(src);
const anchorsOnlyInAPost = (src: string) => !/= readAnchor\(FEED_POST_ATTR/.test(src) && (src.match(/= readReaderAnchor\(FEED_POST_ATTR, ANCHOR_PROBE_Y,/g) ?? []).length === 2;

describe("the Feed comes back in place", () => {
  it("a visited tab returns without every card fading in again", () => {
    expect(tabComesBackInPlace(feed)).toBe(true);
    expect(tabComesBackInPlace(feed.replace("setInstant(true);\n      setItems(cached.items);", "setItems(cached.items);"))).toBe(false);
  });
  it("the position is held on a post only once the reader is in one (both save points)", () => {
    expect(anchorsOnlyInAPost(feed)).toBe(true);
    expect(anchorsOnlyInAPost(feed.replace("= readReaderAnchor(FEED_POST_ATTR, ANCHOR_PROBE_Y,", "= readAnchor(FEED_POST_ATTR, ANCHOR_PROBE_Y,"))).toBe(false);
  });
  it("the story rings and the Continue Watching thumbnails decode in the same frame (no blank frame on a return)", () => {
    expect((rings.match(/decoding="sync"/g) ?? []).length).toBe(3);
    expect((watching.match(/<img src=\{[tr]\.thumbnail\} alt="" decoding="sync"/g) ?? []).length).toBe(2);
  });
});
