import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it } from "vitest";

/**
 * The cold-entry routing branch in `public/sw/routes.js`, exercised against the
 * REAL file.
 *
 * ── Why this test exists at all ───────────────────────────────────────────
 * A service worker is the one script in this codebase where a mistake is not
 * self-correcting: it is installed on the device, it survives a reload, and a
 * redirect loop or a throw inside `respondWith` means the app does not open.
 * This project has already shipped a worker that failed to evaluate at all
 * (duplicate `const SWX`) and a navigation redirect that had to be reverted.
 *
 * So the branch is driven here rather than reasoned about: the file is loaded
 * into a VM with a minimal ServiceWorkerGlobalScope, a fetch event is
 * dispatched, and the response is asserted.
 *
 * The loader's own PWA-only guard is a CSS `display-mode` media query and is
 * NOT testable here (or in headless Chromium — see the 2026-08-11 note). What
 * IS testable, and what actually broke, is the routing.
 */

const SW_DIR = path.resolve(process.cwd(), "public/sw");
const ORIGIN = "https://frenz.example";

interface FetchEventLike {
  request: RequestLike;
  respondWith: (r: unknown) => void;
  preloadResponse: Promise<undefined>;
}

interface RequestLike {
  url: string;
  mode: string;
  method: string;
  referrer: string;
  headers: { get: () => null };
  destination: string;
}

/** Load config.js + routes.js into one VM, the way importScripts() would. */
function loadWorker() {
  let fetchHandler: ((e: FetchEventLike) => void) | null = null;
  const sandbox: Record<string, unknown> = {
    URL,
    Response: class {
      status: number;
      headers: Map<string, string>;
      constructor(_body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
        this.status = init?.status ?? 200;
        this.headers = new Map(Object.entries(init?.headers ?? {}));
      }
      static redirect(url: string, status = 302) {
        // The real one throws on a relative URL — mirror that, because a throw
        // inside respondWith is exactly the failure worth catching.
        if (!/^https?:\/\//.test(url)) throw new TypeError("Failed to parse URL");
        return { __redirectTo: url, status };
      }
    },
    Date,
    Promise,
    // Enough of the CacheStorage surface that the routes which FALL THROUGH
    // this branch (and hand off to networkFirst) settle quietly instead of
    // raising unhandled rejections that would mask a real failure.
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => true }),
      match: async () => undefined,
      keys: async () => [],
    },
    fetch: async () => ({ ok: true, status: 200, type: "basic", clone: () => ({}) }),
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  sandbox.self = sandbox;
  (sandbox as { self: Record<string, unknown> }).self.location = { origin: ORIGIN, href: `${ORIGIN}/sw.js` };
  (sandbox as { self: Record<string, unknown> }).self.addEventListener = (type: string, fn: unknown) => {
    if (type === "fetch") fetchHandler = fn as (e: FetchEventLike) => void;
  };
  (sandbox as { self: Record<string, unknown> }).self.registration = {};

  const ctx = runInNewContext("this", sandbox) as Record<string, unknown>;
  void ctx;
  for (const file of ["log.js", "config.js", "cache-utils.js", "strategies.js", "routes.js"]) {
    runInNewContext(readFileSync(path.join(SW_DIR, file), "utf8"), sandbox, { filename: file });
  }
  if (!fetchHandler) throw new Error("routes.js registered no fetch handler");
  return fetchHandler as (e: FetchEventLike) => void;
}

function navigate(pathname: string, over: Partial<RequestLike> = {}) {
  return {
    url: `${ORIGIN}${pathname}`,
    mode: "navigate",
    method: "GET",
    referrer: "",
    headers: { get: () => null },
    destination: "document",
    ...over,
  } satisfies RequestLike;
}

function dispatch(handler: (e: FetchEventLike) => void, request: RequestLike) {
  let responded: unknown;
  handler({
    request,
    respondWith: (r) => {
      responded = r;
    },
    preloadResponse: Promise.resolve(undefined),
  });
  return responded as { __redirectTo?: string; status?: number } | undefined;
}

describe("service worker cold-entry routing", () => {
  let handler: (e: FetchEventLike) => void;
  beforeEach(() => {
    handler = loadWorker();
  });

  it("forwards a launcher entry at the stale start_url to the loader", () => {
    // The whole point: apps installed before start_url moved still open /home.
    const res = dispatch(handler, navigate("/home"));
    expect(res?.__redirectTo).toBe(`${ORIGIN}/launch.html`);
  });

  it("🔴 uses an ABSOLUTE url — Response.redirect throws on a relative one", () => {
    // A throw inside respondWith fails the navigation: the app would not open.
    const res = dispatch(handler, navigate("/home"));
    expect(res?.__redirectTo).toMatch(/^https:\/\//);
  });

  it("🔴 does not redirect the loader's own hand-off back to /home", () => {
    // Full Bleed mode: launch.html sends the member to /home, carrying a
    // referrer. Without this guard that is an unrecoverable loop.
    const res = dispatch(handler, navigate("/home", { referrer: `${ORIGIN}/launch.html` }));
    expect(res?.__redirectTo).toBeUndefined();
  });

  it("🔴 debounces, so a browser that omits the referrer still cannot loop", () => {
    expect(dispatch(handler, navigate("/home"))?.__redirectTo).toBeTruthy();
    expect(dispatch(handler, navigate("/home"))?.__redirectTo).toBeUndefined();
  });

  it("leaves every other route alone", () => {
    for (const p of ["/downloads", "/", "/reels", "/messages", "/home/extra"]) {
      expect(dispatch(handler, navigate(p))?.__redirectTo, p).toBeUndefined();
    }
  });

  it("ignores a /home that carries a query — that is a real destination, not a launch", () => {
    expect(dispatch(handler, navigate("/home"), )?.__redirectTo).toBeTruthy();
    handler = loadWorker();
    const withQuery = navigate("/home");
    withQuery.url = `${ORIGIN}/home?tab=feed`;
    expect(dispatch(handler, withQuery)?.__redirectTo).toBeUndefined();
  });

  it("does not touch a non-navigation request for /home", () => {
    const res = dispatch(handler, navigate("/home", { mode: "cors", destination: "empty" }));
    expect(res?.__redirectTo).toBeUndefined();
  });
});
