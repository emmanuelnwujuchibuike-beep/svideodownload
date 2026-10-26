import { beforeEach, describe, expect, it, vi } from "vitest";

import { _resetStoryViewers, faceGradient, loadStoryViewers, viewersLine, type StoryViewersData } from "./story-viewers-data";

/**
 * The Story viewer's "who saw it" (the design's "1,204 viewers · Ada, Chris and 1,202 others"): from the REAL list and
 * the REAL total, one request per story shared by the bottom bar and the Seen-by sheet.
 */
const row = (id: string, displayName: string | null, handle: string | null = null) => ({ id, handle, displayName, avatarUrl: null, viewedAt: "2026-10-26T10:00:00Z", screenshotted: false });
const data = (total: number, names: (string | null)[]): StoryViewersData => ({ screenshotAlerts: true, totals: { viewers: total, reactions: 0, reshares: 0 }, viewers: names.map((n, i) => row(`v${i}`, n, `h${i}`)) });

beforeEach(() => _resetStoryViewers());

describe("viewersLine", () => {
  it("first names, then the real remainder", () => {
    expect(viewersLine(data(1204, ["Ada Okafor", "Chris"]))).toBe("Ada, Chris and 1,202 others");
    expect(viewersLine(data(3, ["Ada", "Chris"]))).toBe("Ada, Chris and 1 other");
  });
  it("small lists read naturally, and nobody is 'No viewers yet'", () => {
    expect(viewersLine(data(1, ["Ada"]))).toBe("Ada");
    expect(viewersLine(data(2, ["Ada", "Chris"]))).toBe("Ada and Chris");
    expect(viewersLine(data(0, []))).toBe("No viewers yet");
  });
  it("a viewer with no display name falls back to the handle", () => {
    expect(viewersLine({ ...data(1, []), viewers: [row("x", null, "ada.creates")] })).toBe("ada.creates");
  });
});

describe("loadStoryViewers", () => {
  it("one request per story, shared by every caller while fresh", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ screenshotAlerts: true, totals: { viewers: 2, reactions: 1, reshares: 0 }, viewers: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([loadStoryViewers("s1"), loadStoryViewers("s1")]);
    await loadStoryViewers("s1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadStoryViewers("s1", 0); // the sheet asks for a fresh read
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("🔴 the route's refusal is an error, never an empty 'nobody saw it'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not yours." }), { status: 403 })));
    await expect(loadStoryViewers("s2")).rejects.toThrow("Not yours.");
  });
});

it("a face with no photo always gets the same gradient", () => {
  expect(faceGradient("abc")).toBe(faceGradient("abc"));
  expect(faceGradient("abc")).toMatch(/^linear-gradient/);
});
