import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetAdInventory } from "@/features/monetization/ad-inventory-client";
import { parseAdInventory, mayServeSelf } from "@/lib/monetization/ad-inventory-shape";
import { cdnBucket } from "@/lib/net/cdn-bucket";

const posted: { fn: string; rows: unknown[] }[] = [];
let ingestOk = true;
vi.mock("@/lib/analytics/ingest", () => ({
  postIngest: async (fn: string, payload: { p_rows: unknown[] }) => {
    posted.push({ fn, rows: payload.p_rows });
    return ingestOk;
  },
}));

const { __resetSelfAds, loadSelfAds } = await import("./serving-client");
const { __adEventQueue, __resetAdEvents, flushAdEvents, newAdView, trackAdEvent } = await import("./ad-events-client");

/**
 * The request budget of the ad platform in the browser, measured on the real
 * modules with `fetch` counted:
 *   no live campaign      → 0 requests beyond the inventory every page loads
 *   live campaigns        → 1 per 5-minute bucket per tab, shared by every
 *                           placement and every page change
 *   rotation / no-repeat  → 0 (pure functions, see lib/ads-platform)
 *   events                → 1 batched RPC to Postgres, never one per event
 */

const INV = { v: 1, slots: [], vast: [], global: false, monetag: false };
const PAYLOAD = (b: number) => ({ v: 1, enabled: true, b, placements: {} });

describe("serving client — request budget", () => {
  const calls: string[] = [];
  let inventory: unknown;
  let store: Map<string, string>;
  const T0 = Date.parse("2026-10-07T12:01:00Z");

  beforeEach(() => {
    calls.length = 0;
    __resetSelfAds();
    __resetAdInventory();
    store = new Map();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/ads/inventory")) return new Response(JSON.stringify(inventory), { status: 200 });
      const b = Number(new URL(url, "http://x").searchParams.get("b"));
      return new Response(JSON.stringify(PAYLOAD(b)), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const selfCalls = () => calls.filter((c) => c.startsWith("/api/ads/self"));

  it("no live campaign (self:false or absent) ⇒ ZERO self-serve requests", async () => {
    inventory = { ...INV, self: false };
    expect(await loadSelfAds(T0)).toBeNull();
    __resetSelfAds();
    __resetAdInventory();
    inventory = INV; // an inventory cached before 0195: no opinion ⇒ no
    expect(await loadSelfAds(T0)).toBeNull();
    expect(selfCalls()).toEqual([]);
  });

  it("live campaigns ⇒ ONE request for ten placements across six page changes in a bucket", async () => {
    inventory = { ...INV, self: true };
    const asks = Array.from({ length: 60 }, (_, i) => loadSelfAds(T0 + i * 1000)); // 10 placements × 6 pages, one minute
    const answers = await Promise.all(asks);
    expect(answers.every((a) => a?.v === 1)).toBe(true);
    expect(selfCalls()).toEqual([`/api/ads/self?b=${cdnBucket(T0)}`]);
  });

  it("a new bucket refetches once — only when a placement next asks (no timer)", async () => {
    inventory = { ...INV, self: true };
    await loadSelfAds(T0);
    await loadSelfAds(T0 + 5 * 60_000);
    await loadSelfAds(T0 + 5 * 60_000 + 1);
    expect(selfCalls()).toHaveLength(2);
  });

  it("a reload in the same bucket is served from sessionStorage, not the network", async () => {
    inventory = { ...INV, self: true };
    await loadSelfAds(T0);
    __resetSelfAds(); // the module state a reload loses
    await loadSelfAds(T0 + 10_000);
    expect(selfCalls()).toHaveLength(1);
  });

  it("a failed payload request serves nothing and throws nothing", async () => {
    inventory = { ...INV, self: true };
    vi.stubGlobal("fetch", async (url: string) => (url.startsWith("/api/ads/inventory") ? new Response(JSON.stringify(inventory)) : new Response(null, { status: 503 })));
    expect(await loadSelfAds(T0)).toBeNull();
  });

  it("inventory parse keeps `self`, and mayServeSelf fails CLOSED", () => {
    expect(parseAdInventory({ ...INV, self: true })?.self).toBe(true);
    expect(parseAdInventory(INV)?.self).toBeUndefined();
    expect(mayServeSelf(null)).toBe(false);
    expect(mayServeSelf(parseAdInventory(INV))).toBe(false);
    expect(mayServeSelf(parseAdInventory({ ...INV, self: true }))).toBe(true);
  });
});

describe("ad events — once each, batched", () => {
  beforeEach(() => {
    posted.length = 0;
    ingestOk = true;
    __resetAdEvents();
    vi.stubGlobal("localStorage", { getItem: () => "visitor-1" });
  });
  afterEach(() => vi.unstubAllGlobals());

  const view = () => newAdView({ campaignId: "c1", creativeId: "cr1", placement: "global_top_banner", page: "download" });

  it("a double-fired click on one view is sent once; a NEW view (next rotation) is a new event", async () => {
    const v = view();
    expect(trackAdEvent(v, "click")).toBe(true);
    expect(trackAdEvent(v, "click")).toBe(false);
    trackAdEvent(view(), "click");
    await flushAdEvents();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.fn).toBe("track_ad_events");
    expect(posted[0]!.rows).toHaveLength(2);
  });

  it("loaded, visible and impression are distinct events — loading is not an impression", async () => {
    const v = view();
    trackAdEvent(v, "loaded");
    await flushAdEvents();
    expect((posted[0]!.rows as { t: string }[]).map((r) => r.t)).toEqual(["loaded"]);
  });

  it("20 events are ONE request, not twenty", async () => {
    for (let i = 0; i < 20; i++) trackAdEvent(newAdView({ campaignId: "c", creativeId: `cr${i}`, placement: "p", page: "feed" }), "impression");
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.rows).toHaveLength(20);
  });

  it("a failed batch is kept for the next flush with the SAME ids (replay-safe)", async () => {
    ingestOk = false;
    trackAdEvent(view(), "click");
    await flushAdEvents();
    const ids = (posted[0]!.rows as { id: string }[]).map((r) => r.id);
    expect(__adEventQueue().map((r) => r.id)).toEqual(ids);
    ingestOk = true;
    await flushAdEvents();
    expect((posted[1]!.rows as { id: string }[]).map((r) => r.id)).toEqual(ids);
    expect(__adEventQueue()).toHaveLength(0);
  });
});

/** The rule the owner named twice: rotation is never a request, and nothing polls. */
function pollingViolations(files: { name: string; src: string }[]): string[] {
  return files
    .filter(({ src }) => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");
      return /setInterval\s*\(/.test(code) || /\.channel\s*\(|\.subscribe\s*\(|postgres_changes/.test(code);
    })
    .map(({ name }) => name);
}

describe("no polling, no Realtime, no per-rotation request", () => {
  it("nothing in the ad platform calls setInterval or opens a Realtime channel", () => {
    const files = ["lib/ads-platform", "features/ads-platform", "features/ads-platform/serve"].flatMap((d) =>
      readdirSync(join(process.cwd(), d))
        .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
        .map((f) => ({ name: `${d}/${f}`, src: readFileSync(join(process.cwd(), d, f), "utf8") })),
    );
    expect(files.length).toBeGreaterThanOrEqual(8); // not vacuous
    expect(pollingViolations(files)).toEqual([]);
  });

  it("the rotation module makes no request at all", () => {
    expect(readFileSync(join(process.cwd(), "lib/ads-platform/rotation.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/fetch\s*\(/);
  });

  it("every ad-platform fetch of /api/ads/self is gated on the inventory", () => {
    const src = readFileSync(join(process.cwd(), "features/ads-platform/serving-client.ts"), "utf8");
    expect(src).toMatch(/loadAdInventory\(\)[\s\S]*mayServeSelf\(inv\)[\s\S]*fetch\(`\/api\/ads\/self/);
  });

  it("TEETH: a polling ad fetcher is caught", () => {
    expect(pollingViolations([{ name: "bad.ts", src: "setInterval(() => fetch('/api/ads/self'), 5000)" }])).toEqual(["bad.ts"]);
    expect(pollingViolations([{ name: "rt.ts", src: "supabase.channel('ads').on('postgres_changes', {}, f).subscribe()" }])).toEqual(["rt.ts"]);
    expect(pollingViolations([{ name: "ok.ts", src: "// setInterval is banned here\nsetTimeout(next, ms)" }])).toEqual([]);
  });
});
