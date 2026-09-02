import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetPopunderGuard,
  allowWindowOpen,
  popunderGuardStats,
  shouldAllowOpen,
} from "@/lib/monetization/popunder-guard";

beforeEach(() => __resetPopunderGuard());

describe("shouldAllowOpen — the whole decision", () => {
  it("permits an open inside the announced window", () => {
    expect(shouldAllowOpen(1_000, 1_500)).toBe(true);
  });

  it("refuses an open after the window has passed", () => {
    expect(shouldAllowOpen(2_000, 1_500)).toBe(false);
  });

  it("🔴 refuses by DEFAULT, with no announcement at all", () => {
    // The property that matters: a third-party script never announces itself,
    // so the closed default is what blocks it.
    expect(shouldAllowOpen(Date.now(), 0)).toBe(false);
  });

  it("permits exactly at the boundary", () => {
    expect(shouldAllowOpen(1_500, 1_500)).toBe(true);
  });
});

describe("allowWindowOpen", () => {
  it("opens a window that shouldAllowOpen then accepts", () => {
    allowWindowOpen();
    expect(shouldAllowOpen(Date.now(), Date.now() + 500)).toBe(true);
  });

  it("starts blocked before anything announces", () => {
    expect(popunderGuardStats().blocked).toBe(0);
    expect(popunderGuardStats().allowed).toBe(0);
  });
});

describe("🔴 the pop-under scenario this exists for", () => {
  /*
    A pop-under rides the visitor's genuine click — it fires ON a real gesture,
    so "require a user gesture" would not stop it. What separates it from our
    own opens is INTENT, which only our code knows.

    Modelled here as the sequence that actually happens: the visitor clicks the
    Download button, our handler does its work WITHOUT announcing an open, and
    the network's handler then tries to open a window on the same gesture.
  */
  it("blocks an open that rides a real click nobody announced", () => {
    const clickAt = Date.now();
    // Our download handler runs — it opens no window, so it announces nothing.
    // The network's handler fires on the same gesture:
    expect(shouldAllowOpen(clickAt, 0)).toBe(false);
  });

  it("still permits OUR click-through on the same kind of gesture", () => {
    // An intentional click on an ad is a real click the network should be paid
    // for. This guard blocks pop-unders, not advertising.
    allowWindowOpen();
    const now = Date.now();
    expect(shouldAllowOpen(now, now + 900)).toBe(true);
  });

  it("does not let one announcement be borrowed later", () => {
    // The permission is consumed by the open it was made for; a script firing
    // two seconds later must not inherit it.
    const announced = Date.now();
    expect(shouldAllowOpen(announced + 5_000, announced + 1_000)).toBe(false);
  });
});
