import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetAdInventory } from "@/features/monetization/ad-inventory-client";
import { __resetAdCache, loadZoneAd } from "@/features/monetization/ad-cache";
import {
  AD_INVENTORY_BUCKET_MS,
  anyVast,
  inventoryBucket,
  mayServeSlot,
  mayServeVast,
  parseAdInventory,
  type AdInventory,
} from "@/lib/monetization/ad-inventory-shape";

/**
 * Owner, 2026-10-05: "ads are not running now so they shouldn't request any
 * API, only the one that may run in the future can request when ads are there."
 *
 * Measured before this: ~7 private ad invocations per idle page view, every one
 * answering null. These tests pin the two properties that make the fix safe:
 * an EMPTY inventory sends nothing, and an UNKNOWN one sends exactly what it
 * always did — the gate may save a request but can never cost an impression.
 */

const EMPTY: AdInventory = { v: 1, slots: [], vast: [], global: false, monetag: false };

describe("ad inventory — the pure rules", () => {
  it("unknown (null) inventory asks for everything — fail OPEN", () => {
    expect(mayServeSlot(null, "result_top")).toBe(true);
    expect(mayServeVast(null, "download_complete")).toBe(true);
    expect(anyVast(null)).toBe(true);
  });

  it("an empty inventory asks for nothing", () => {
    expect(mayServeSlot(EMPTY, "result_top")).toBe(false);
    expect(mayServeVast(EMPTY, "download_complete")).toBe(false);
    expect(anyVast(EMPTY)).toBe(false);
  });

  it("only the listed zones are asked for", () => {
    const inv: AdInventory = { ...EMPTY, slots: ["bottom_banner"], vast: ["download_complete"] };
    expect(mayServeSlot(inv, "bottom_banner")).toBe(true);
    expect(mayServeSlot(inv, "result_top")).toBe(false);
    expect(mayServeVast(inv, "download_complete")).toBe(true);
    expect(mayServeVast(inv, "idle_interstitial")).toBe(false);
  });

  it("anything malformed parses to null (unknown), never to an empty inventory", () => {
    for (const bad of [null, undefined, 1, "x", [], {}, { ...EMPTY, v: 2 }, { ...EMPTY, slots: "a" }, { ...EMPTY, slots: [1] }, { ...EMPTY, global: "no" }]) {
      expect(parseAdInventory(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseAdInventory(EMPTY)).toEqual(EMPTY);
  });

  it("the bucket changes every five minutes, so no TTL rewrite can pin an old answer longer", () => {
    expect(AD_INVENTORY_BUCKET_MS).toBe(300_000);
    expect(inventoryBucket(0)).toBe(inventoryBucket(299_999));
    expect(inventoryBucket(300_000)).toBe(inventoryBucket(0) + 1);
  });
});

describe("ad inventory — the batched zone cache really skips the request", () => {
  const calls: string[] = [];
  let inventory: unknown;

  beforeEach(() => {
    calls.length = 0;
    __resetAdCache();
    __resetAdInventory();
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/ads/inventory")) {
        return inventory === "fail"
          ? new Response(null, { status: 503 })
          : new Response(JSON.stringify(inventory), { status: 200 });
      }
      const zones = decodeURIComponent(new URL(url, "http://x").searchParams.get("zones") ?? "").split(",");
      return new Response(JSON.stringify({ ads: Object.fromEntries(zones.map((z) => [z, null])) }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EMPTY inventory: every zone resolves null and /api/ads is never called", async () => {
    inventory = EMPTY;
    const answers = await Promise.all([loadZoneAd("result_top"), loadZoneAd("bottom_banner"), loadZoneAd("homepage_top")]);
    expect(answers).toEqual([null, null, null]);
    expect(calls.filter((c) => c.startsWith("/api/ads?"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("/api/ads/inventory"))).toHaveLength(1);
  });

  it("partial inventory: only the servable zone is requested", async () => {
    inventory = { ...EMPTY, slots: ["bottom_banner"] };
    await Promise.all([loadZoneAd("result_top"), loadZoneAd("bottom_banner")]);
    expect(calls.filter((c) => c.startsWith("/api/ads?"))).toEqual([`/api/ads?zones=${encodeURIComponent("bottom_banner")}`]);
  });

  it("UNKNOWN inventory (endpoint failed): asks for every zone, exactly as before", async () => {
    inventory = "fail";
    await Promise.all([loadZoneAd("result_top"), loadZoneAd("bottom_banner")]);
    expect(calls.filter((c) => c.startsWith("/api/ads?"))).toEqual([`/api/ads?zones=${encodeURIComponent("result_top,bottom_banner")}`]);
  });
});

/**
 * Every client file that calls an ad endpoint must consult the inventory —
 * the guard against a NEW ad surface quietly reinstating the idle requests.
 */
const AD_ENDPOINT = /fetch\(\s*[`"']\/api\/(ads(\?|\/exoclick)|monetag)/;
function ungatedAdFetchers(files: { name: string; src: string }[]): string[] {
  return files
    .filter(({ src }) => AD_ENDPOINT.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
    .filter(({ src }) => !/loadAdInventory\(\)/.test(src))
    .map(({ name }) => name);
}

describe("ad inventory — no ad fetcher bypasses it", () => {
  it("every features/monetization file that fetches an ad endpoint consults the inventory", () => {
    const dir = join(process.cwd(), "features", "monetization");
    const files = (readdirSync(dir, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .map((f) => ({ name: f, src: readFileSync(join(dir, f), "utf8") }));
    const fetchers = files.filter(({ src }) => AD_ENDPOINT.test(src));
    expect(fetchers.length).toBeGreaterThanOrEqual(6); // the guard is not vacuous
    expect(ungatedAdFetchers(files)).toEqual([]);
  });

  it("TEETH: an ungated fetcher is caught", () => {
    expect(ungatedAdFetchers([{ name: "new-ad.tsx", src: `fetch("/api/ads?zone=result_top")` }])).toEqual(["new-ad.tsx"]);
    expect(ungatedAdFetchers([{ name: "ok.tsx", src: `loadAdInventory().then(() => fetch("/api/monetag"))` }])).toEqual([]);
  });
});
