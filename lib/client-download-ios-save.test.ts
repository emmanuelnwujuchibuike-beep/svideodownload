import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 2026-10-06: "save to device button is redownloading the media and give
 * an ios download complete sound like it going through the browser". On iOS a
 * share sheet refused for lack of a live tap (NotAllowedError) fell through to
 * the anchor download — a Safari download. It must ask for another tap instead.
 */

function stubIos(share: () => Promise<void>) {
  const clicks: string[] = [];
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5, share, canShare: () => true });
  vi.stubGlobal("window", { navigator: globalThis.navigator });
  vi.stubGlobal("document", {
    createElement: () => ({ click: () => clicks.push("anchor"), remove() {}, set href(_v: string) {}, set download(_v: string) {}, style: {} }),
    body: { appendChild() {}, removeChild() {} },
  });
  return clicks;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("iOS Save to device never becomes a browser download", () => {
  it("a share sheet refused for lack of a tap asks for another tap — no anchor download", async () => {
    const clicks = stubIos(async () => {
      throw Object.assign(new Error("needs a gesture"), { name: "NotAllowedError" });
    });
    const { saveToDevice } = await import("@/lib/client-download");
    const outcome = await saveToDevice(new Blob(["x"], { type: "video/mp4" }), "clip.mp4");
    expect(outcome).toBe("needs-tap");
    expect(clicks).toEqual([]);
  });

  it("an opened share sheet is a share, a dismissed one is a cancel", async () => {
    stubIos(async () => undefined);
    const { saveToDevice } = await import("@/lib/client-download");
    expect(await saveToDevice(new Blob(["x"], { type: "video/mp4" }), "clip.mp4")).toBe("shared");
  });
});
