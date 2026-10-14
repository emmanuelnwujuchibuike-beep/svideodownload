import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hoistById, JUST_PUBLISHED_TTL_MS, markJustPublished, takeJustPublished } from "./just-published";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a new post opens the feed on top (owner, 2026-10-14)", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it("the mark is taken once", () => {
    markJustPublished("p1", 1000);
    expect(takeJustPublished(1000)).toBe("p1");
    expect(takeJustPublished(1000)).toBeNull();
  });

  it("an old or malformed mark is ignored", () => {
    markJustPublished("p1", 0);
    expect(takeJustPublished(JUST_PUBLISHED_TTL_MS + 1)).toBeNull();
    store.set("frenz:just-published", "{not json");
    expect(takeJustPublished()).toBeNull();
    store.set("frenz:just-published", JSON.stringify({ id: 5, at: 0 }));
    expect(takeJustPublished(0)).toBeNull();
  });

  it("blocked storage never throws", () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => markJustPublished("p1")).not.toThrow();
    expect(takeJustPublished()).toBeNull();
  });

  it("hoists the post to the front, and leaves the rest in order", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(hoistById(items, "c").map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(hoistById(items, "a")).toBe(items);
    expect(hoistById(items, "zz")).toBe(items);
  });

  it("the composer marks, and the feed takes and hoists", () => {
    expect(src("features/create/composer-core.ts")).toContain("if (postId) markJustPublished(postId);");
    expect(src("features/social/publish-button.tsx")).toContain("markJustPublished(json.id as string);");
    const feed = src("features/feed/smart-feed.tsx");
    expect(feed).toContain("const postId = takeJustPublished();");
    expect(feed).toContain("entry.items = hoistById(entry.items, postId);");
    // after the continuity restore, before "alive on return"
    const take = feed.indexOf("takeJustPublished();");
    expect(take).toBeGreaterThan(feed.indexOf("const snap = loadFeedContinuity();"));
    expect(take).toBeLessThan(feed.indexOf("const lastHiddenAt = useRef"));
  });
});
