import { afterEach, describe, expect, it, vi } from "vitest";

import { canPlayHevc } from "./hevc-support";

/**
 * The whole point of this predicate is that it FAILS CLOSED. A false positive
 * ships an unplayable file to somebody's phone; a false negative just re-encodes
 * as it does today. Every branch below is checking which way a given failure
 * falls, not that the happy path works.
 *
 * The suite runs in the project's node environment, so `document` is stubbed per
 * test rather than provided by jsdom.
 */

function stubVideo(canPlayType: unknown) {
  vi.stubGlobal("document", {
    createElement: () => ({ canPlayType }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canPlayHevc", () => {
  it("is false with no document at all — SSR must never claim a decoder", () => {
    vi.stubGlobal("document", undefined);
    expect(canPlayHevc()).toBe(false);
  });

  it('accepts "probably" and also "maybe" — "maybe" is what Safari returns', () => {
    // Excluding "maybe" would drop iOS, which has the most complete HEVC
    // support of any platform here.
    stubVideo(() => "probably");
    expect(canPlayHevc()).toBe(true);
    stubVideo(() => "maybe");
    expect(canPlayHevc()).toBe(true);
  });

  it('is false when the browser answers "" for every HEVC codec string', () => {
    stubVideo(() => "");
    expect(canPlayHevc()).toBe(false);
  });

  it("is false when canPlayType is missing entirely (locked-down webview)", () => {
    stubVideo(undefined);
    expect(canPlayHevc()).toBe(false);
  });

  it("is false when canPlayType THROWS rather than answering", () => {
    stubVideo(() => {
      throw new Error("nope");
    });
    expect(canPlayHevc()).toBe(false);
  });

  it("is false when creating the element itself throws", () => {
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no elements here");
      },
    });
    expect(canPlayHevc()).toBe(false);
  });

  it("asks about hvc1 AND hev1 — a browser may recognise only one fourCC", () => {
    const asked: string[] = [];
    stubVideo((t: string) => {
      asked.push(t);
      return "";
    });
    canPlayHevc();
    expect(asked.some((t) => t.includes("hvc1"))).toBe(true);
    expect(asked.some((t) => t.includes("hev1"))).toBe(true);
  });
});
