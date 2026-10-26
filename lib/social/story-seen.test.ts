import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoryCaches, confirmedSeenIds } from "./story-cache";
import { isGroupSeen, isStorySeen, recordStoryView, resetStoryViewRequests, type ViewOutcome } from "./story-seen";
import type { StoryGroup, StoryItem } from "./stories";

/**
 * Stories Part 3 (2026-10-26) — watched or not is the SERVER's answer (each story's `seen`, from the
 * viewer's own story_views rows) plus only the views this session's POST had CONFIRMED. Before, opening a
 * ring wrote a device-local mark that greyed every story in it, on this phone only.
 */
const store = new Map<string, string>();
const signIn = (handle: string | null) => (handle ? store.set("frenz-identity", JSON.stringify({ handle, avatarUrl: null })) : store.delete("frenz-identity"));

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  clearStoryCaches();
  resetStoryViewRequests();
  signIn("me");
});

const item = (id: string, seen?: boolean): StoryItem => ({ id, mediaUrl: `https://media.test/${id}.jpg`, mediaKind: "image", caption: null, createdAt: new Date().toISOString(), allowReshare: true, thumbnailUrl: null, seen });
const ring = (...stories: StoryItem[]): StoryGroup => ({ userId: "u1", handle: "ada", displayName: "Ada", avatarUrl: null, isVerified: false, stories });
const answer = (o: ViewOutcome) => vi.fn(async (_id: string) => o);

describe("seen state — per story, from the server", () => {
  it("an unseen story is told apart from a watched one", () => {
    expect(isStorySeen(item("a", true), confirmedSeenIds())).toBe(true);
    expect(isStorySeen(item("b", false), confirmedSeenIds())).toBe(false);
    expect(isStorySeen(item("c"), confirmedSeenIds())).toBe(false); // a pre-Part-3 disk copy: not seen
  });

  it("a ring is watched only when EVERY story in it is", () => {
    expect(isGroupSeen(ring(item("a", true), item("b", true)), confirmedSeenIds())).toBe(true);
    expect(isGroupSeen(ring(item("a", true), item("b", false)), confirmedSeenIds())).toBe(false);
    expect(isGroupSeen(ring(), confirmedSeenIds())).toBe(false);
  });

  it("🔴 watching one story does not mark the author's other stories", async () => {
    await recordStoryView("a", answer({ recorded: true, available: true }));
    const overlay = confirmedSeenIds();
    expect(isStorySeen(item("a", false), overlay)).toBe(true);
    expect(isStorySeen(item("b", false), overlay)).toBe(false);
    expect(isGroupSeen(ring(item("a", false), item("b", false)), overlay)).toBe(false);
  });

  it("after a refresh the server's `seen` carries it — the overlay is not needed", () => {
    clearStoryCaches(); // a reload: memory is gone
    signIn("me");
    expect(isGroupSeen(ring(item("a", true)), confirmedSeenIds())).toBe(true);
  });

  it("🔴 another account on the same phone does not inherit the views", async () => {
    await recordStoryView("a", answer({ recorded: true, available: true }));
    signIn("someone-else");
    expect(isStorySeen(item("a", false), confirmedSeenIds())).toBe(false);
  });
});

/* The viewer and the rings need a browser to run; their wiring is pinned from the source (the repo's pattern). */
describe("the surfaces use it", async () => {
  const { readFileSync } = await import("node:fs");
  const viewer = readFileSync("features/app-shell/dashboard/story-viewer.tsx", "utf8");
  it("🔴 the viewer no longer marks a whole ring on open, and records per STORY id through recordStoryView", () => {
    expect(viewer).not.toMatch(/markGroupSeen|loadSeenMap|localStorage/);
    expect(viewer).toContain("void recordStoryView(storyId).then((out) => {");
    expect(viewer).toContain("}, [storyId, isOwn, dropStories]);"); // keyed on the id: a re-render never re-sends
    expect(viewer).not.toMatch(/fetch\(`\/api\/stories\/\$\{[^}]*\}\/views`/); // one path for the POST
  });
  it("opens at the first unwatched story and advances by the shared rules", () => {
    expect(viewer).toContain("return exact >= 0 ? exact : startIndex(groups[gi], isSeen);");
    expect(viewer).toContain("nextPosition(groups, { gi, si }, isSeenRef.current)");
    expect(viewer).toContain("onDeleted={(id) => dropStories([id])}");
  });
  it.each(["features/app-shell/dashboard/stories-row.tsx", "features/friends/friends-stories.tsx"])("%s colours rings from the server + confirmed views", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("useSeenOverlay()");
    expect(src).not.toMatch(/loadSeenMap|markGroupSeen|onGroupSeen/);
  });
});

describe("recording a view", () => {
  it("🔴 a failed request marks nothing — and the next showing tries once more", async () => {
    const fail = answer({ recorded: false, available: true });
    await recordStoryView("a", fail);
    expect(confirmedSeenIds().has("a")).toBe(false);
    await recordStoryView("a", fail);
    expect(fail).toHaveBeenCalledTimes(2); // one request per showing, never a loop
  });

  it("🔴 a network error marks nothing", async () => {
    const out = await recordStoryView("a", vi.fn(async () => ({ recorded: false, available: true })));
    expect(out.recorded).toBe(false);
    expect(confirmedSeenIds().size).toBe(0);
  });

  it("duplicate events — re-renders, an effect running twice — send ONE request", async () => {
    const ok = answer({ recorded: true, available: true });
    await Promise.all([recordStoryView("a", ok), recordStoryView("a", ok), recordStoryView("a", ok)]);
    await recordStoryView("a", ok);
    expect(ok).toHaveBeenCalledTimes(1);
    expect([...confirmedSeenIds()]).toEqual(["a"]);
  });

  it("a story no longer available is reported back, and not marked seen", async () => {
    const out = await recordStoryView("a", answer({ recorded: false, available: false }));
    expect(out.available).toBe(false);
    expect(confirmedSeenIds().has("a")).toBe(false);
  });

  it("the real request: one POST to this story's own views route, kept alive past a close", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, recorded: true, available: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await recordStoryView("s-1")).toEqual({ recorded: true, available: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/stories/s-1/views", { method: "POST", keepalive: true });
  });

  it("🔴 the real request failing (HTTP 500, or offline) marks nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await recordStoryView("s-2")).toEqual({ recorded: false, available: true });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await recordStoryView("s-3")).toEqual({ recorded: false, available: true });
    expect(confirmedSeenIds().size).toBe(0);
  });
});
