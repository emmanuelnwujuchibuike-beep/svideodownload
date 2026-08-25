import { describe, expect, it } from "vitest";

import { MAX_BATCH_ITEMS } from "@/lib/downloads/multi-link-config";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

import {
  batchReducer,
  countItems,
  countSelected,
  initialBatchState,
  normalizeSourceUrl,
  selectedItems,
  sourceProgress,
  zipEligible,
  type BatchState,
} from "./state";

/**
 * The batch tree's contract, tested where it actually lives.
 *
 * §3 and §6 are not styling requests — "never merge the results of different
 * source URLs" and "selecting in Source 1 must NOT modify Source 2" are
 * behavioural guarantees, and the only honest way to hold them is to assert
 * them on the reducer that owns the tree. Rendering the panel to check would
 * be testing a layout; this tests the rule.
 */

function fmt(over: Partial<MediaFormat> & { formatId: string; kind: MediaKind }): MediaFormat {
  return {
    label: over.formatId,
    ext: "mp4",
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: null,
    acodec: null,
    ...over,
  };
}

function meta(over: Partial<VideoMetadata> & { formats: MediaFormat[] }): VideoMetadata {
  return {
    id: "id",
    platform: "tiktok",
    platformName: "TikTok",
    sourceUrl: "https://example.com/a",
    title: "A post",
    description: null,
    thumbnail: null,
    durationSeconds: null,
    creator: null,
    uploadDate: null,
    viewCount: null,
    likeCount: null,
    webpageUrl: "https://example.com/a",
    extractor: "tiktok",
    ...over,
  };
}

/** Two sources, each fetched, each with its own photos. */
function twoSources(): BatchState {
  let s = batchReducer(initialBatchState, { type: "addSource", url: "https://a.com/1" });
  s = batchReducer(s, { type: "addSource", url: "https://b.com/2" });
  const [one, two] = s.sources;
  s = batchReducer(s, {
    type: "fetchSuccess",
    sourceId: one!.id,
    // Deliberately the SAME format ids in both sources — the collision that a
    // formatId-keyed selection would leak across.
    metadata: meta({
      formats: [
        fmt({ formatId: "img-0", kind: "image", isSeparateItem: true, directUrl: "https://a.com/0.jpg" }),
        fmt({ formatId: "img-1", kind: "image", isSeparateItem: true, directUrl: "https://a.com/1.jpg" }),
      ],
    }),
  });
  s = batchReducer(s, {
    type: "fetchSuccess",
    sourceId: two!.id,
    metadata: meta({
      platformName: "Pinterest",
      formats: [
        fmt({ formatId: "img-0", kind: "image", isSeparateItem: true, directUrl: "https://b.com/0.jpg" }),
        fmt({ formatId: "img-1", kind: "image", isSeparateItem: true, directUrl: "https://b.com/1.jpg" }),
        fmt({ formatId: "img-2", kind: "image", isSeparateItem: true, directUrl: "https://b.com/2.jpg" }),
      ],
    }),
  });
  return s;
}

describe("source separation (§3, §8)", () => {
  it("keeps every post under the source that produced it", () => {
    const s = twoSources();
    expect(s.sources).toHaveLength(2);
    expect(s.sources[0]!.items).toHaveLength(2);
    expect(s.sources[1]!.items).toHaveLength(3);
    // Ownership is structural: every item's sourceId matches its container.
    for (const source of s.sources) {
      for (const item of source.items) expect(item.sourceId).toBe(source.id);
    }
  });

  it("gives colliding format ids distinct item ids across sources", () => {
    const s = twoSources();
    const a = s.sources[0]!.items.map((i) => i.id);
    const b = s.sources[1]!.items.map((i) => i.id);
    // Both sources really do carry a format literally called "img-0"…
    expect(s.sources[0]!.items[0]!.formatId).toBe("img-0");
    expect(s.sources[1]!.items[0]!.formatId).toBe("img-0");
    // …and no item id is shared, which is what stops one tick from moving two.
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it("records each source's own platform, not the last one fetched", () => {
    const s = twoSources();
    expect(s.sources[0]!.platformName).toBe("TikTok");
    expect(s.sources[1]!.platformName).toBe("Pinterest");
  });
});

describe("selection is source-scoped (§6)", () => {
  it("deselecting a whole source leaves siblings untouched", () => {
    const s = twoSources();
    expect(countSelected(s)).toBe(5); // discovered posts arrive ticked
    const after = batchReducer(s, {
      type: "setSourceSelection",
      sourceId: s.sources[0]!.id,
      selected: false,
    });
    expect(after.sources[0]!.items.every((i) => !i.selected)).toBe(true);
    expect(after.sources[1]!.items.every((i) => i.selected)).toBe(true);
    expect(countSelected(after)).toBe(3);
  });

  it("toggling one item changes exactly one item", () => {
    const s = twoSources();
    const target = s.sources[1]!.items[0]!;
    const after = batchReducer(s, {
      type: "toggleItem",
      sourceId: s.sources[1]!.id,
      itemId: target.id,
    });
    expect(after.sources[1]!.items[0]!.selected).toBe(false);
    // The identically-named format in the other source is untouched.
    expect(after.sources[0]!.items[0]!.selected).toBe(true);
    expect(countSelected(after)).toBe(4);
  });

  it("returns untouched sources by identity, so React can skip them", () => {
    // This is what makes §44's "without unnecessary re-renders" true — the
    // memo'd SourceCard only re-renders when its own object changed.
    const s = twoSources();
    const after = batchReducer(s, {
      type: "setSourceSelection",
      sourceId: s.sources[0]!.id,
      selected: false,
    });
    expect(after.sources[1]).toBe(s.sources[1]);
    expect(after.sources[0]).not.toBe(s.sources[0]);
  });
});

describe("what one source contributes (§5)", () => {
  it("treats multiple separate items as multiple posts", () => {
    const s = twoSources();
    expect(countItems(s)).toBe(5);
  });

  it("treats alternative qualities of one video as ONE post", () => {
    // A plain TikTok returns 1080/720/360 of the same clip. Offering three
    // would download the same video three times and claim it was three posts.
    let s = batchReducer(initialBatchState, { type: "addSource", url: "https://a.com/v" });
    s = batchReducer(s, {
      type: "fetchSuccess",
      sourceId: s.sources[0]!.id,
      metadata: meta({
        formats: [
          fmt({ formatId: "1080", kind: "video" }),
          fmt({ formatId: "720", kind: "video" }),
          fmt({ formatId: "360", kind: "video" }),
        ],
      }),
    });
    expect(s.sources[0]!.items).toHaveLength(1);
    expect(s.sources[0]!.items[0]!.formatId).toBe("1080");
  });

  it("prefers the video on a pin that also offers its cover image", () => {
    // Pinterest video pins now carry both (server/extractors/pinterest.ts).
    // The batch takes the video; the picker is where you choose otherwise.
    let s = batchReducer(initialBatchState, { type: "addSource", url: "https://pin.it/x" });
    s = batchReducer(s, {
      type: "fetchSuccess",
      sourceId: s.sources[0]!.id,
      metadata: meta({
        formats: [
          fmt({ formatId: "720", kind: "video" }),
          fmt({ formatId: "pin-img", kind: "image", directUrl: "https://i.pinimg.com/x.jpg" }),
        ],
      }),
    });
    expect(s.sources[0]!.items).toHaveLength(1);
    expect(s.sources[0]!.items[0]!.kind).toBe("video");
  });
});

describe("the item ceiling is enforced at discovery, not at download", () => {
  it("adds overflow unticked rather than dropping it", () => {
    let s = initialBatchState;
    s = batchReducer(s, { type: "addSource", url: "https://a.com/1" });
    const formats = Array.from({ length: MAX_BATCH_ITEMS + 10 }, (_, i) =>
      fmt({ formatId: `i${i}`, kind: "image", isSeparateItem: true, directUrl: `https://a.com/${i}.jpg` }),
    );
    s = batchReducer(s, { type: "fetchSuccess", sourceId: s.sources[0]!.id, metadata: meta({ formats }) });
    // Every post is visible…
    expect(countItems(s)).toBe(MAX_BATCH_ITEMS + 10);
    // …but only what the reward session will accept is selected.
    expect(countSelected(s)).toBe(MAX_BATCH_ITEMS);
    expect(s.notice).toMatch(new RegExp(`${MAX_BATCH_ITEMS}`));
  });

  it("never lets Select all cross the ceiling", () => {
    let s = initialBatchState;
    s = batchReducer(s, { type: "addSource", url: "https://a.com/1" });
    const formats = Array.from({ length: MAX_BATCH_ITEMS + 5 }, (_, i) =>
      fmt({ formatId: `i${i}`, kind: "image", isSeparateItem: true }),
    );
    s = batchReducer(s, { type: "fetchSuccess", sourceId: s.sources[0]!.id, metadata: meta({ formats }) });
    s = batchReducer(s, { type: "setAllSelection", selected: false });
    expect(countSelected(s)).toBe(0);
    s = batchReducer(s, { type: "setAllSelection", selected: true });
    expect(countSelected(s)).toBe(MAX_BATCH_ITEMS);
  });

  it("always allows deselecting, even at the ceiling", () => {
    let s = initialBatchState;
    s = batchReducer(s, { type: "addSource", url: "https://a.com/1" });
    const formats = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) =>
      fmt({ formatId: `i${i}`, kind: "image", isSeparateItem: true }),
    );
    s = batchReducer(s, { type: "fetchSuccess", sourceId: s.sources[0]!.id, metadata: meta({ formats }) });
    expect(countSelected(s)).toBe(MAX_BATCH_ITEMS);
    const target = s.sources[0]!.items[0]!;
    s = batchReducer(s, { type: "toggleItem", sourceId: s.sources[0]!.id, itemId: target.id });
    expect(countSelected(s)).toBe(MAX_BATCH_ITEMS - 1);
  });
});

describe("duplicate detection (§22)", () => {
  it("ignores case, www, trailing slash and share-tracking params", () => {
    const canonical = normalizeSourceUrl("https://www.instagram.com/p/ABC/");
    expect(normalizeSourceUrl("HTTPS://Instagram.com/p/ABC")).toBe(canonical);
    expect(normalizeSourceUrl("https://instagram.com/p/ABC/?igshid=xyz")).toBe(canonical);
    expect(normalizeSourceUrl("https://instagram.com/p/ABC/?utm_source=share")).toBe(canonical);
    expect(normalizeSourceUrl("http://www.instagram.com/p/ABC/#footer")).toBe(canonical);
  });

  it("keeps meaningful query params, which identify different posts", () => {
    expect(normalizeSourceUrl("https://x.com/i/status?v=1")).not.toBe(
      normalizeSourceUrl("https://x.com/i/status?v=2"),
    );
  });

  it("flags an edit that collides with an existing source", () => {
    let s = twoSources();
    s = batchReducer(s, {
      type: "editSource",
      sourceId: s.sources[1]!.id,
      url: "https://a.com/1",
    });
    expect(s.notice).toBe("This source has already been added.");
  });

  it("discards a source's results when its URL changes", () => {
    // They belonged to the OLD link — keeping them would show posts under a
    // URL that never produced them.
    let s = twoSources();
    s = batchReducer(s, { type: "editSource", sourceId: s.sources[0]!.id, url: "https://c.com/9" });
    expect(s.sources[0]!.items).toEqual([]);
    expect(s.sources[0]!.status).toBe("idle");
    // The sibling keeps everything.
    expect(s.sources[1]!.items).toHaveLength(3);
  });
});

describe("failure isolation and progress (§12, §13)", () => {
  it("reports progress per source, not merged", () => {
    let s = twoSources();
    const a = s.sources[0]!;
    const b = s.sources[1]!;
    s = batchReducer(s, { type: "itemQueued", itemId: a.items[0]!.id, taskId: "t1" });
    s = batchReducer(s, { type: "itemQueued", itemId: b.items[0]!.id, taskId: "t2" });
    s = batchReducer(s, { type: "itemStatus", taskId: "t1", status: "done" });
    s = batchReducer(s, { type: "itemStatus", taskId: "t2", status: "failed", error: "boom" });

    expect(sourceProgress(s.sources[0]!)).toMatchObject({ total: 1, done: 1, failed: 0 });
    expect(sourceProgress(s.sources[1]!)).toMatchObject({ total: 1, done: 0, failed: 1 });
  });

  it("a failure in one source does not touch another", () => {
    let s = twoSources();
    s = batchReducer(s, { type: "itemQueued", itemId: s.sources[1]!.items[0]!.id, taskId: "t2" });
    s = batchReducer(s, { type: "itemStatus", taskId: "t2", status: "failed", error: "boom" });
    expect(s.sources[0]!.items.every((i) => i.status === "idle")).toBe(true);
  });

  it("retries only the failed items, and only in the named source", () => {
    let s = twoSources();
    s = batchReducer(s, { type: "itemQueued", itemId: s.sources[0]!.items[0]!.id, taskId: "t1" });
    s = batchReducer(s, { type: "itemQueued", itemId: s.sources[1]!.items[0]!.id, taskId: "t2" });
    s = batchReducer(s, { type: "itemStatus", taskId: "t1", status: "failed", error: "a" });
    s = batchReducer(s, { type: "itemStatus", taskId: "t2", status: "failed", error: "b" });

    s = batchReducer(s, { type: "retryFailed", sourceId: s.sources[0]!.id });
    expect(s.sources[0]!.items[0]!.status).toBe("idle");
    expect(s.sources[0]!.items[0]!.error).toBeNull();
    // The other source's failure is still a failure — "Retry Source" retries
    // one source, not everything.
    expect(s.sources[1]!.items[0]!.status).toBe("failed");
  });

  it("updates every item sharing one deduped task", () => {
    // The manager dedupes identical in-flight downloads, so the same photo
    // added from two sources shares a task id. Both cards must still be right.
    let s = twoSources();
    s = batchReducer(s, { type: "itemQueued", itemId: s.sources[0]!.items[0]!.id, taskId: "shared" });
    s = batchReducer(s, { type: "itemQueued", itemId: s.sources[1]!.items[0]!.id, taskId: "shared" });
    s = batchReducer(s, { type: "itemStatus", taskId: "shared", status: "done" });
    expect(s.sources[0]!.items[0]!.status).toBe("done");
    expect(s.sources[1]!.items[0]!.status).toBe("done");
  });
});

describe("ZIP eligibility (§15)", () => {
  it("offers a ZIP for a multi-image selection", () => {
    expect(zipEligible(twoSources())).toBe(true);
  });

  it("refuses one for video, which must stream to disk instead", () => {
    let s = batchReducer(initialBatchState, { type: "addSource", url: "https://a.com/v" });
    s = batchReducer(s, {
      type: "fetchSuccess",
      sourceId: s.sources[0]!.id,
      metadata: meta({
        formats: [
          fmt({ formatId: "v1", kind: "video", isSeparateItem: true }),
          fmt({ formatId: "v2", kind: "video", isSeparateItem: true }),
        ],
      }),
    });
    expect(zipEligible(s)).toBe(false);
  });

  it("refuses one for a single item, where it is pure overhead", () => {
    let s = batchReducer(initialBatchState, { type: "addSource", url: "https://a.com/1" });
    s = batchReducer(s, {
      type: "fetchSuccess",
      sourceId: s.sources[0]!.id,
      metadata: meta({ formats: [fmt({ formatId: "img", kind: "image", directUrl: "https://a/x.jpg" })] }),
    });
    expect(zipEligible(s)).toBe(false);
  });
});

describe("removing a source", () => {
  it("takes its items with it and leaves the rest alone", () => {
    let s = twoSources();
    const keptId = s.sources[1]!.id;
    s = batchReducer(s, { type: "removeSource", sourceId: s.sources[0]!.id });
    expect(s.sources).toHaveLength(1);
    expect(s.sources[0]!.id).toBe(keptId);
    expect(countItems(s)).toBe(3);
    expect(selectedItems(s)).toHaveLength(3);
  });
});
