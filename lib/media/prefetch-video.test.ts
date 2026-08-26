import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetVideoPrefetch, cancelVideoPrefetch, prefetchVideo } from "./prefetch-video";

/*
  `getSyncConditions` is the shared Data-Saver / effective-type gate every
  prefetch in this codebase respects. Mocked so each case can state the network
  it is describing instead of depending on whatever the test runner reports.
*/
const conditions = vi.hoisted(() => ({ current: { saveData: false, effectiveType: "4g" } }));
vi.mock("@/lib/media/network-conditions", () => ({
  getSyncConditions: () => conditions.current,
}));

const URL_A = "https://media.frenzsave.com/a/videos/1.mp4";
const URL_B = "https://media.frenzsave.com/b/videos/2.mp4";

/** A 206 answer of `size` bytes, the shape a ranged request should get. */
function partial(size: number) {
  return {
    status: 206,
    body: {},
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(size)),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetVideoPrefetch();
  conditions.current = { saveData: false, effectiveType: "4g" };
  fetchMock = vi.fn(() => Promise.resolve(partial(1024)));
  vi.stubGlobal("fetch", fetchMock);
  /*
    🔴 REQUIRED, and not boilerplate. `prefetchVideo` returns early when
    `window` is undefined, and these run in the node environment — so without
    this stub every case below passes by never reaching the code it claims to
    test, including the Data Saver ones, whose whole point is that they DON'T
    fetch. Caught exactly that way on 2026-08-26.
  */
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetVideoPrefetch();
});

describe("prefetchVideo", () => {
  it("requests only a bounded PREFIX, never the whole file", async () => {
    prefetchVideo(URL_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    // A clip here runs to ~8 MB; warming every one in full is the cost this
    // exists to avoid.
    expect(init.headers.Range).toBe("bytes=0-2097151");
  });

  it("never fetches the same URL twice in a session", () => {
    prefetchVideo(URL_A);
    prefetchVideo(URL_A);
    prefetchVideo(URL_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips entirely on Data Saver", () => {
    conditions.current = { saveData: true, effectiveType: "4g" };
    prefetchVideo(URL_A);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["slow-2g", "2g", "3g"])("skips on a %s connection", (effectiveType) => {
    conditions.current = { saveData: false, effectiveType };
    prefetchVideo(URL_A);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops once the session byte budget is spent", async () => {
    // 24 MB budget, ~2 MB a clip → the thirteenth call must not fire. Without
    // this ceiling, "warm the next clip" becomes "download the whole feed" on
    // a long scroll.
    fetchMock.mockImplementation(() => Promise.resolve(partial(2 * 1024 * 1024)));
    for (let i = 0; i < 12; i++) {
      prefetchVideo(`https://media.frenzsave.com/v/${i}.mp4`);
      await Promise.resolve();
      await Promise.resolve();
    }
    const spent = fetchMock.mock.calls.length;
    // Stated explicitly so this cannot pass with a budget that pays out nothing.
    expect(spent).toBe(12);
    prefetchVideo("https://media.frenzsave.com/v/over-budget.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(spent);
  });

  it("drops a response that ignored the range rather than reading the whole file", async () => {
    const abort = vi.fn();
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
    // A 200 means the origin is about to hand over every byte — exactly what
    // the prefix exists to prevent, so it must not be drained.
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, body: {}, arrayBuffer }));
    vi.stubGlobal(
      "AbortController",
      class {
        signal = {};
        abort = abort;
      },
    );
    prefetchVideo(URL_A);
    await Promise.resolve();
    await Promise.resolve();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalled();
  });

  it("ignores a null/undefined url without throwing", () => {
    prefetchVideo(null);
    prefetchVideo(undefined);
    prefetchVideo("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a network failure is silent — the viewer still fetches normally", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    expect(() => prefetchVideo(URL_B)).not.toThrow();
    await Promise.resolve();
  });
});

describe("cancelVideoPrefetch", () => {
  it("does not re-arm a cancelled URL on the next scroll-by", () => {
    prefetchVideo(URL_A);
    cancelVideoPrefetch(URL_A);
    prefetchVideo(URL_A);
    // Still one: re-arming on every scroll-by is how a jittery scroll turns
    // into a fetch storm.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is safe on a URL that was never warmed", () => {
    expect(() => cancelVideoPrefetch(URL_B)).not.toThrow();
    expect(() => cancelVideoPrefetch(null)).not.toThrow();
  });
});
