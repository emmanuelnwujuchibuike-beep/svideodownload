import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * The service worker must never answer a download with an OPAQUE cached
 * response — and must never route a download into the image cache at all.
 *
 * ── The bug this guards (owner, 2026-08-30) ───────────────────────────────────
 * "downloading post sometimes fail and show service worker is opaque or load
 * failed."
 *
 * Both strings are one failure. `routes.js` picked the image strategy on URL
 * EXTENSION alone, regardless of `destination`, so a programmatic
 * `fetch("https://cdn…/photo.jpg")` — a download — was served from IMAGE_CACHE.
 * That cache legitimately stores OPAQUE responses (`isCacheable` allows them,
 * correctly: a cross-origin `<img>` is a `no-cors` request). A Cache is keyed by
 * URL and Vary and NOTHING ELSE, so the `cors`-mode download matched the entry
 * the `<img>` had stored, and the Handle Fetch algorithm turned it into a
 * network error:
 *
 *   The FetchEvent for "…" resulted in a network error response: an "opaque"
 *   response was used for a request whose type is not no-cors.
 *
 * The caller's `fetch()` therefore REJECTS — Chrome "Failed to fetch", Safari
 * "Load failed" — and the download dies. It needs the same URL to have been
 * rendered as an image first and to still be inside IMAGE_CACHE's 80-entry cap,
 * which is precisely why it failed only "sometimes".
 *
 * ── Why it is driven here rather than reasoned about ──────────────────────────
 * Reading the router is what missed this: nothing about `isImage` LOOKS wrong
 * until you know that a Cache ignores request mode. So the real files are
 * loaded into a VM with a cache that already holds an opaque entry — the state
 * a real device is in — and the actual responses are asserted. Same harness as
 * sw-cold-entry.test.ts, for the same reason: a worker bug is installed on the
 * device and survives a reload.
 */

const SW_DIR = path.resolve(process.cwd(), "public/sw");
const ORIGIN = "https://frenz.example";
const IMG = "https://cdn.example/photo.jpg";

interface ResponseLike {
  ok: boolean;
  status: number;
  type: string;
  body?: string;
  /** `cacheFirst`'s captive-portal check reads content-type off every response. */
  headers: { get: (k: string) => string | null };
  clone: () => ResponseLike;
}

interface RequestLike {
  url: string;
  mode: string;
  method: string;
  referrer: string;
  headers: { get: () => null };
  destination: string;
}

function response(over: Partial<ResponseLike> = {}): ResponseLike {
  const res: ResponseLike = {
    ok: true,
    status: 200,
    type: "basic",
    body: "bytes",
    // An opaque response really does expose empty headers, so `get` returning
    // null for one is the accurate model, not a shortcut.
    headers: { get: () => (over.type === "opaque" ? null : "application/javascript") },
    clone: () => ({ ...res }),
    ...over,
  };
  res.clone = () => ({ ...res });
  return res;
}

/** An opaque response, as a `no-cors` cross-origin fetch really returns one. */
function opaque(): ResponseLike {
  return response({ ok: false, status: 0, type: "opaque", body: "opaque-bytes" });
}

interface Harness {
  fetchHandler: (e: { request: RequestLike; respondWith: (r: unknown) => void; preloadResponse: Promise<undefined> }) => void;
  SWX: {
    canServe: (r: ResponseLike | null | undefined, req: RequestLike) => boolean;
    staleWhileRevalidate: (req: RequestLike, cacheName: string) => Promise<ResponseLike>;
    cacheFirst: (req: RequestLike, cacheName: string) => Promise<ResponseLike>;
    IMAGE_CACHE: string;
    STATIC_CACHE: string;
  };
  /** URL -> stored response, shared by every named cache (keyed by URL only,
   *  exactly like the real Cache API — which is the whole point). */
  store: Map<string, ResponseLike>;
  fetchCalls: RequestLike[];
}

function loadWorker({ networkFails = false }: { networkFails?: boolean } = {}): Harness {
  const store = new Map<string, ResponseLike>();
  const fetchCalls: RequestLike[] = [];
  let fetchHandler: Harness["fetchHandler"] | null = null;

  const cache = {
    match: async (req: RequestLike | string) => store.get(typeof req === "string" ? req : req.url),
    put: async (req: RequestLike | string, res: ResponseLike) => {
      store.set(typeof req === "string" ? req : req.url, res);
    },
    keys: async () => [...store.keys()],
    delete: async (req: RequestLike | string) => store.delete(typeof req === "string" ? req : req.url),
  };

  const sandbox: Record<string, unknown> = {
    URL,
    Response: class {},
    Date,
    Promise,
    Map,
    Set,
    caches: { open: async () => cache, match: async (req: RequestLike) => store.get(req.url), keys: async () => [] },
    // Mirrors the browser: a `no-cors` cross-origin request yields an OPAQUE
    // response; anything else yields a readable one.
    fetch: async (req: RequestLike) => {
      fetchCalls.push(req);
      if (networkFails) throw new TypeError("Load failed");
      return req.mode === "no-cors" ? opaque() : response({ type: "cors", body: "fresh-bytes" });
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  sandbox.self = sandbox;
  (sandbox as { self: Record<string, unknown> }).self.location = { origin: ORIGIN, href: `${ORIGIN}/sw.js` };
  (sandbox as { self: Record<string, unknown> }).self.addEventListener = (type: string, fn: unknown) => {
    if (type === "fetch") fetchHandler = fn as Harness["fetchHandler"];
  };
  (sandbox as { self: Record<string, unknown> }).self.registration = {};

  runInNewContext("this", sandbox);
  for (const file of ["log.js", "config.js", "cache-utils.js", "strategies.js", "routes.js"]) {
    runInNewContext(readFileSync(path.join(SW_DIR, file), "utf8"), sandbox, { filename: file });
  }
  if (!fetchHandler) throw new Error("routes.js registered no fetch handler");
  return { fetchHandler, SWX: sandbox.SWX as Harness["SWX"], store, fetchCalls };
}

/** A cross-origin `<img src>` load — `no-cors`, destination "image". */
function imageRequest(url = IMG): RequestLike {
  return { url, mode: "no-cors", method: "GET", referrer: "", headers: { get: () => null }, destination: "image" };
}

/** A programmatic `fetch(url)` — i.e. a download. `cors`, no destination. */
function downloadRequest(url = IMG): RequestLike {
  return { url, mode: "cors", method: "GET", referrer: "", headers: { get: () => null }, destination: "" };
}

function dispatch(h: Harness, request: RequestLike): unknown {
  let responded: unknown;
  h.fetchHandler({ request, respondWith: (r) => void (responded = r), preloadResponse: Promise.resolve(undefined) });
  return responded;
}

describe("service worker — opaque responses and downloads", () => {
  describe("canServe", () => {
    it("🔴 refuses to hand an opaque entry to a request that is not no-cors", () => {
      const { SWX } = loadWorker();
      expect(SWX.canServe(opaque(), downloadRequest())).toBe(false);
    });

    it("still allows opaque for the no-cors requests it was cached for", () => {
      const { SWX } = loadWorker();
      expect(SWX.canServe(opaque(), imageRequest())).toBe(true);
    });

    it("allows readable responses either way, and never serves nothing", () => {
      const { SWX } = loadWorker();
      expect(SWX.canServe(response({ type: "cors" }), downloadRequest())).toBe(true);
      expect(SWX.canServe(response({ type: "basic" }), imageRequest())).toBe(true);
      expect(SWX.canServe(undefined, downloadRequest())).toBe(false);
    });
  });

  describe("routing", () => {
    it("🔴 does not route a programmatic fetch into the image cache, .jpg or not", () => {
      const h = loadWorker();
      // No respondWith at all — the browser's own pipeline transfers the file,
      // which is also what keeps a download from being served stale bytes.
      expect(dispatch(h, downloadRequest())).toBeUndefined();
      expect(dispatch(h, downloadRequest(`${ORIGIN}/media/clip.png`))).toBeUndefined();
    });

    it("still caches real images, which is what IMAGE_CACHE is for", async () => {
      const h = loadWorker();
      const res = (await dispatch(h, imageRequest())) as ResponseLike;
      expect(res.type).toBe("opaque");
      expect(h.store.get(IMG)?.type).toBe("opaque");
    });
  });

  describe("staleWhileRevalidate", () => {
    it("🔴 goes to network when the only cached copy is opaque and the request is not", async () => {
      const h = loadWorker();
      // The state a real device reaches: the page rendered the image first.
      await dispatch(h, imageRequest());
      expect(h.store.get(IMG)?.type).toBe("opaque");

      // Now the SAME url is downloaded. Before the fix this resolved to the
      // opaque entry, which the browser converts into a network error.
      const res = await h.SWX.staleWhileRevalidate(downloadRequest(), h.SWX.IMAGE_CACHE);
      expect(res.type).not.toBe("opaque");
      expect(res.body).toBe("fresh-bytes");
    });

    it("heals the cache — the unusable entry is replaced, not left to fail again", async () => {
      const h = loadWorker();
      await dispatch(h, imageRequest());
      await h.SWX.staleWhileRevalidate(downloadRequest(), h.SWX.IMAGE_CACHE);
      expect(h.store.get(IMG)?.type).toBe("cors");
    });

    it("🔴 rejects rather than resolving to undefined when the network fails cold", async () => {
      // `respondWith(undefined)` is itself a network error ("resolved with an
      // object that is not a Response") — the worker's own bug reported to the
      // caller as the same "Load failed" a real outage gives.
      const h = loadWorker({ networkFails: true });
      await expect(h.SWX.staleWhileRevalidate(imageRequest(), h.SWX.IMAGE_CACHE)).rejects.toThrow("Load failed");
    });

    it("still falls back to a usable cached copy when the network fails", async () => {
      const h = loadWorker();
      await dispatch(h, imageRequest());
      const offline = loadWorker({ networkFails: true });
      offline.store.set(IMG, response({ type: "cors", body: "cached-bytes" }));
      const res = await offline.SWX.staleWhileRevalidate(downloadRequest(), offline.SWX.IMAGE_CACHE);
      expect(res.body).toBe("cached-bytes");
    });
  });

  describe("cacheFirst", () => {
    it("🔴 does not serve an opaque hit to a cors request either", async () => {
      const h = loadWorker();
      const url = `${ORIGIN}/_next/static/chunk.js`;
      h.store.set(url, opaque());
      const req = downloadRequest(url);
      const res = await h.SWX.cacheFirst(req, h.SWX.STATIC_CACHE);
      expect(res.type).not.toBe("opaque");
    });
  });

  it("bumps SWX.VERSION so installed devices actually get this", () => {
    // The worker is served to installed devices from their own copy: a fix that
    // does not change VERSION reaches nobody who already has the bug. The bump
    // also abandons the cache buckets holding the opaque entries that trip it.
    const config = readFileSync(path.join(SW_DIR, "config.js"), "utf8");
    const version = config.match(/SWX\.VERSION\s*=\s*"v(\d+)"/);
    expect(version, "SWX.VERSION not found in public/sw/config.js").not.toBeNull();
    expect(Number(version![1])).toBeGreaterThanOrEqual(18);
  });
});
