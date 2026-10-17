import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { itemsLabel, membershipChip, priceLine } from "./exclusive-labels";
import { firstPageIsReplay, linkExpired, mayAutoRefresh, PREVIEW_BATCH, refreshPreview } from "./feed-previews";

/**
 * Frenz Exclusive Part 15 — the Exclusive feed's client logic: the batched preview refresh (one
 * request for many failures, one in flight, never an automatic loop), the expiry decision, the
 * router-cache replay decision, and the words on the cards.
 */

describe("is a preview link expired? only when a clock says so", () => {
  const birth = { issuedAt: 1_000_000, receivedAt: 50_000, ttl: 300 };
  it("fresh by both clocks: not expired (an error then is a real failure, not a refresh)", () => {
    expect(linkExpired(birth, 1_000_000 + 60_000, 50_000 + 60_000)).toBe(false);
  });
  it("past the lifetime (less a 30 s margin) by the server clock OR the browser's own: expired", () => {
    expect(linkExpired(birth, 1_000_000 + 270_000, 50_000 + 1_000)).toBe(true);
    // a phone clock set far in the past can't stretch a link's life: the monotonic clock still counts
    expect(linkExpired(birth, 1_000_000 - 3_600_000, 50_000 + 270_000)).toBe(true);
  });
});

describe("automatic refresh is bounded — even with a phone clock minutes fast (Part 16)", () => {
  /** what usePreview does: refresh automatically only when mayAutoRefresh says so, else "failed" */
  function simulate(clockAheadMs: number, errors: number) {
    const server = 1_800_000_000_000;
    let mono = 1_000;
    let birth = { issuedAt: server, receivedAt: mono, ttl: 300 };
    let lastAuto: number | null = null;
    let refreshes = 0;
    for (let i = 0; i < errors; i++) {
      mono += 50; // the re-signed image fails again 50 ms later (object missing, host blocked …)
      if (!mayAutoRefresh(birth, lastAuto, server + clockAheadMs + (mono - 1_000), mono)) return { refreshes, failed: true };
      lastAuto = mono;
      refreshes++;
      birth = { issuedAt: server + (mono - 1_000), receivedAt: mono, ttl: 300 }; // a brand-new link
    }
    return { refreshes, failed: false };
  }
  it("teeth: the expiry check ALONE would refresh on every error with a clock 5 min fast", () => {
    const server = 1_800_000_000_000;
    expect(linkExpired({ issuedAt: server, receivedAt: 1_000, ttl: 300 }, server + 300_000, 1_000)).toBe(true);
  });
  it("clock 5 min fast, an image that always fails: ONE automatic refresh, then 'failed' (Retry is a tap)", () => {
    expect(simulate(300_000, 50)).toEqual({ refreshes: 1, failed: true });
  });
  it("correct clock, a fresh link that fails: no automatic refresh at all", () => {
    expect(simulate(0, 50)).toEqual({ refreshes: 0, failed: true });
  });
  it("a link that really ran out (correct clock) still refreshes automatically", () => {
    expect(mayAutoRefresh({ issuedAt: 0, receivedAt: 0, ttl: 300 }, null, 280_000, 280_000)).toBe(true);
    // … and again only a full link lifetime after the previous automatic refresh
    expect(mayAutoRefresh({ issuedAt: 0, receivedAt: 0, ttl: 300 }, 100_000, 380_000, 300_000)).toBe(false);
    expect(mayAutoRefresh({ issuedAt: 0, receivedAt: 0, ttl: 300 }, 100_000, 380_000, 370_000)).toBe(true);
  });
});

describe("a server-rendered first page replayed from the router cache is asked for again", () => {
  it("fresh and first shown: used as is (no second request after hydration)", () => {
    expect(firstPageIsReplay(1_000_000, false, 1_000_000 + 5_000)).toBe(false);
  });
  it("shown before in this tab, or older than a minute: re-checked", () => {
    expect(firstPageIsReplay(1_000_000, true, 1_000_000 + 1_000)).toBe(true);
    expect(firstPageIsReplay(1_000_000, false, 1_000_000 + 61_000)).toBe(true);
    expect(firstPageIsReplay(1_000_000, false, 1_000_000 - 61_000)).toBe(true);
  });
});

describe("the batched, access-checked refresh", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const answer = (previews: Record<string, string | null>) => ({ ok: true, json: async () => ({ previews, issuedAt: Date.now(), previewTtl: 300 }) });
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
  };

  it("many tiles failing together share ONE request; each gets its own answer (url / none / gone)", async () => {
    fetchMock.mockResolvedValue(answer({ a: "https://private.example/a?sig=2", b: null }));
    const all = Promise.all(["a", "b", "c", "a"].map((id) => refreshPreview(id)));
    await settle();
    const [a, b, c, a2] = await all;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { ids: string[] };
    expect(sent.ids.sort()).toEqual(["a", "b", "c"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/sub/feed/previews");
    expect(a).toMatchObject({ kind: "url", url: "https://private.example/a?sig=2" });
    expect(a2).toEqual(a);
    expect(b).toEqual({ kind: "none" });
    expect(c).toEqual({ kind: "gone" });
  });

  it("a refused or failed request answers 'failed' for every tile — and asks nothing again by itself", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const r = refreshPreview("x");
    await settle();
    expect(await r).toEqual({ kind: "failed" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const r2 = refreshPreview("y");
    await settle();
    expect(await r2).toEqual({ kind: "failed" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only one request in flight; a storm is split into bounded batches, one after another", async () => {
    let release: () => void = () => {};
    fetchMock.mockImplementation(
      (_u: string, init: { body: string }) =>
        new Promise((resolve) => {
          const ids = (JSON.parse(init.body) as { ids: string[] }).ids;
          release = () => resolve(answer(Object.fromEntries(ids.map((id) => [id, null]))));
        }),
    );
    const ids = Array.from({ length: PREVIEW_BATCH + 5 }, (_, i) => `p${i}`);
    const all = Promise.all(ids.map((id) => refreshPreview(id)));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { ids: string[] }).ids).toHaveLength(PREVIEW_BATCH);
    // more failures while the first is out: still one in flight
    void refreshPreview("late");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body) as { ids: string[] }).ids).toHaveLength(6);
    release();
    await settle();
    expect((await all).every((r) => r.kind === "none")).toBe(true);
  });
});

describe("the words on the cards", () => {
  it("one way to say what a post holds", () => {
    expect(itemsLabel(1, false)).toBe("1 photo");
    expect(itemsLabel(4, false)).toBe("4 photos");
    expect(itemsLabel(1, true)).toBe("1 video");
    expect(itemsLabel(3, true)).toBe("3 items");
    expect(itemsLabel(0, false)).toBe("Exclusive post");
  });

  it("membership: never invents a date, says 'ends' in the renewal window, and never claims access after the end", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(membershipChip(undefined, now)).toBeNull();
    expect(membershipChip(null, now)).toEqual({ tone: "active", text: "Subscribed", label: "Subscribed" });
    expect(membershipChip("2026-11-20T00:00:00Z", now)).toMatchObject({ tone: "active", text: "Subscribed" });
    expect(membershipChip("2026-11-20T00:00:00Z", now)!.label).toMatch(/access until .*2026/);
    expect(membershipChip("2026-10-19T00:00:00Z", now)).toMatchObject({ tone: "ending" });
    expect(membershipChip("2026-10-19T00:00:00Z", now)!.text).toMatch(/^Ends /);
    expect(membershipChip("2026-10-16T00:00:00Z", now)).toMatchObject({ tone: "ended", text: "Access ended" });
  });

  it("price on the card: only the total the subscriber pays — no fee breakdown (owner: that's checkout's)", () => {
    expect(priceLine({ totalCents: 1100, periodDays: 30 })).toBe("$11.00 for 30 days");
    const card = readFileSync(join(process.cwd(), "features", "sub", "exclusive-feed.tsx"), "utf8");
    // nothing on the card reads the fee or writes it out
    expect(card).not.toMatch(/\.feeCents\b|\.feePercent\b|% fee|\bfee \(/);
    // teeth: the removed breakdown line would be caught
    expect("{usd(creator.feeCents)} fee ({creator.feePercent}%)").toMatch(/\.feeCents\b|\.feePercent\b|% fee|\bfee \(/);
  });
});
