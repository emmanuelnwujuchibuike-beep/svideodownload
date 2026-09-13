import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * `networkFirst` in `public/sw/strategies.js`, exercised against the REAL file:
 * a navigation whose "network" answer actually came from the browser's HTTP
 * cache is revalidated, a fresh one is served as-is, and a transient rejection
 * is retried once before the cached page is used.
 *
 * ── The bug this pins (owner, 2026-09-13, second report of the same screen) ─
 *
 * "It shows this colourless almost blank page when I enter the browser on
 * cold start." Cloudflare rewrites the document's browser TTL to 7200 s, so
 * the phone's HTTP cache answers the worker's `fetch()` AND the navigation
 * preload with a two-hour-old document for two hours after every visit; a
 * deploy in that window leaves its hashed assets 404ing and the page paints
 * as raw text. The only trace an HTTP-cache hit leaves is its original `Date`
 * header — and that is what `networkFirst` now reads.
 *
 * Same harness shape as the other `sw-*.test.ts` files: config + cache-utils +
 * strategies loaded into a VM with a minimal ServiceWorkerGlobalScope, and the
 * strategy called directly.
 */

const SW_DIR = path.resolve(process.cwd(), "public/sw");
const ORIGIN = "https://frenz.example";

interface RequestLike {
  url: string;
  mode: string;
  method: string;
  cache?: string;
  headers: { get: (k: string) => string | null };
}

interface ResponseLike {
  ok: boolean;
  status: number;
  type: string;
  body: string;
  headers: { get: (k: string) => string | null };
  clone: () => ResponseLike;
}

function doc(body: string, dateMsAgo: number): ResponseLike {
  const date = new Date(Date.now() - dateMsAgo).toUTCString();
  const res: ResponseLike = {
    ok: true,
    status: 200,
    type: "basic",
    body,
    headers: { get: (k) => (k.toLowerCase() === "date" ? date : k.toLowerCase() === "content-type" ? "text/html" : null) },
    clone: () => ({ ...res }),
  };
  return res;
}

function navigation(): RequestLike {
  return { url: `${ORIGIN}/`, mode: "navigate", method: "GET", headers: { get: (k) => (k === "accept" ? "text/html" : null) } };
}

interface Harness {
  networkFirst: (req: RequestLike, o: Record<string, unknown>) => Promise<ResponseLike>;
  fetchCalls: RequestLike[];
  store: Map<string, ResponseLike>;
}

function loadStrategies(script: (req: RequestLike, n: number) => ResponseLike | Promise<ResponseLike>): Harness {
  const store = new Map<string, ResponseLike>();
  const fetchCalls: RequestLike[] = [];
  const cache = {
    match: async (req: RequestLike | string) => store.get(typeof req === "string" ? req : req.url),
    put: async (req: RequestLike | string, res: ResponseLike) => {
      store.set(typeof req === "string" ? req : req.url, res);
    },
    keys: async () => [...store.keys()],
    delete: async () => true,
  };
  /** The worker builds its revalidating request with `new Request(url, init)`. */
  class RequestCtor implements RequestLike {
    url: string;
    mode = "same-origin";
    method: string;
    cache?: string;
    headers: { get: (k: string) => string | null };
    constructor(url: string, init: { method?: string; cache?: string; headers?: Record<string, string> } = {}) {
      this.url = url;
      this.method = init.method ?? "GET";
      this.cache = init.cache;
      const h = init.headers ?? {};
      this.headers = { get: (k) => h[k] ?? h[k.toLowerCase()] ?? null };
    }
  }
  const sandbox: Record<string, unknown> = {
    URL,
    Request: RequestCtor,
    Response: class {},
    Date,
    Promise,
    Map,
    Set,
    setTimeout,
    caches: { open: async () => cache, match: async (req: RequestLike) => store.get(req.url), keys: async () => [] },
    fetch: async (req: RequestLike) => {
      fetchCalls.push(req);
      return script(req, fetchCalls.length);
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  sandbox.self = sandbox;
  (sandbox as { self: Record<string, unknown> }).self.location = { origin: ORIGIN, href: `${ORIGIN}/sw.js` };
  (sandbox as { self: Record<string, unknown> }).self.navigator = { onLine: true };
  (sandbox as { self: Record<string, unknown> }).self.addEventListener = () => {};
  (sandbox as { self: Record<string, unknown> }).self.registration = {};

  runInNewContext("this", sandbox);
  for (const file of ["log.js", "config.js", "cache-utils.js", "strategies.js"]) {
    runInNewContext(readFileSync(path.join(SW_DIR, file), "utf8"), sandbox, { filename: file });
  }
  const SWX = sandbox.SWX as { networkFirst: Harness["networkFirst"] };
  return { networkFirst: SWX.networkFirst, fetchCalls, store };
}

describe("networkFirst — a document from the HTTP cache is not the network's answer", () => {
  it("serves a FRESH document straight through, one request, no revalidation", async () => {
    const h = loadStrategies(() => doc("fresh", 3_000));
    const res = await h.networkFirst(navigation(), { cacheName: "pages", offlineFallback: () => doc("offline", 0) });
    expect(res.body).toBe("fresh");
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("🔴 revalidates a document whose Date is older than five minutes, and serves the live one", async () => {
    const h = loadStrategies((req) => (req.cache === "no-cache" ? doc("live", 0) : doc("two-hours-old", 2 * 60 * 60 * 1000)));
    const res = await h.networkFirst(navigation(), { cacheName: "pages", offlineFallback: () => doc("offline", 0) });
    expect(res.body).toBe("live");
    expect(h.fetchCalls).toHaveLength(2);
    expect(h.fetchCalls[1]!.cache).toBe("no-cache");
    expect(h.fetchCalls[1]!.mode).not.toBe("navigate");
  });

  it("does the same when the stale document arrived through navigation PRELOAD", async () => {
    const h = loadStrategies(() => doc("live", 0));
    const res = await h.networkFirst(navigation(), {
      cacheName: "pages",
      preload: Promise.resolve(doc("preloaded-and-stale", 60 * 60 * 1000)),
      offlineFallback: () => doc("offline", 0),
    });
    expect(res.body).toBe("live");
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.cache).toBe("no-cache");
  });

  it("keeps the stale copy when revalidation itself fails — a document beats nothing", async () => {
    const h = loadStrategies((req) => {
      if (req.cache === "no-cache") throw new TypeError("Load failed");
      return doc("two-hours-old", 2 * 60 * 60 * 1000);
    });
    const res = await h.networkFirst(navigation(), { cacheName: "pages", offlineFallback: () => doc("offline", 0) });
    expect(res.body).toBe("two-hours-old");
  });

  it("retries ONCE after a transient rejection while online, before touching the page cache", async () => {
    const h = loadStrategies((_req, n) => {
      if (n === 1) throw new TypeError("The network connection was lost.");
      return doc("second-try", 0);
    });
    h.store.set(`${ORIGIN}/`, doc("cached-from-last-deploy", 0));
    const res = await h.networkFirst(navigation(), { cacheName: "pages", offlineFallback: () => doc("offline", 0) });
    expect(res.body).toBe("second-try");
    expect(h.fetchCalls).toHaveLength(2);
  });

  it("still falls back to the cached page when the network genuinely fails twice", async () => {
    const h = loadStrategies(() => {
      throw new TypeError("Load failed");
    });
    h.store.set(`${ORIGIN}/`, doc("cached", 0));
    const res = await h.networkFirst(navigation(), { cacheName: "pages", offlineFallback: () => doc("offline", 0) });
    expect(res.body).toBe("cached");
  });

  it("leaves non-navigation requests alone — no retry, no Date check", async () => {
    const h = loadStrategies(() => doc("old-api", 60 * 60 * 1000));
    const req: RequestLike = { ...navigation(), url: `${ORIGIN}/api/thing`, mode: "cors" };
    const res = await h.networkFirst(req, { cacheName: null, offlineFallback: () => doc("offline", 0) });
    expect(res.body).toBe("old-api");
    expect(h.fetchCalls).toHaveLength(1);
  });
});
