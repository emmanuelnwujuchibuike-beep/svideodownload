import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * The PWA's white screen (owner, 2026-10-28: "fix the white screen on the PWA"). The app paints nothing — its loader
 * included — until its render-blocking stylesheet has loaded, and every deploy ships that stylesheet under a new URL.
 * /launch.html now asks the worker to download it while the navigation runs (strategies.js warmAppShellCss), and the
 * app page's own request waits on that download instead of starting a second one. Exercised against the REAL worker
 * files in a VM, the same harness shape as the other sw-*.test.ts files.
 */
const SW_DIR = path.resolve(process.cwd(), "public/sw");
const ORIGIN = "https://frenz.example";
const CSS = ["/_next/static/css/aaa111.css?dpl=dpl_X", "/_next/static/css/bbb222.css?dpl=dpl_X"];
const PAGE = `<html><head><link rel="stylesheet" href="${CSS[0]!.replace("&", "&amp;")}" data-precedence="next"><link rel="stylesheet" href="${CSS[1]}" data-precedence="next"></head><body></body></html>`;

type Res = { ok: boolean; status: number; type: string; headers: { get: (k: string) => string | null }; text: () => Promise<string>; clone: () => Res; body: string };
const res = (body: string, type: string): Res => {
  const r: Res = { ok: true, status: 200, type: "basic", body, headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) }, text: async () => body, clone: () => r };
  return r;
};

function load(opts: { cssDelayMs?: number } = {}) {
  const store = new Map<string, Res>();
  const fetches: string[] = [];
  const cache = {
    match: async (req: { url: string } | string) => store.get(typeof req === "string" ? req : req.url),
    put: async (req: { url: string } | string, r: Res) => void store.set(typeof req === "string" ? req : req.url, r),
    keys: async () => [...store.keys()],
    delete: async () => true,
  };
  class RequestCtor {
    url: string;
    mode = "same-origin";
    method = "GET";
    cache?: string;
    headers = { get: () => null };
    constructor(input: string | { url: string }, init: { cache?: string } = {}) {
      this.url = new URL(typeof input === "string" ? input : input.url, ORIGIN).href;
      this.cache = init.cache;
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
    clearTimeout,
    caches: { open: async () => cache, match: async (req: { url: string }) => store.get(req.url), keys: async () => [] },
    fetch: async (input: string | { url: string }) => {
      const url = new URL(typeof input === "string" ? input : input.url, ORIGIN).href;
      fetches.push(url.replace(ORIGIN, ""));
      if (url.endsWith("/history")) return res(PAGE, "text/html");
      if (opts.cssDelayMs) await new Promise((r) => setTimeout(r, opts.cssDelayMs));
      return res("body{}", "text/css");
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  sandbox.self = sandbox;
  Object.assign(sandbox, { location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` }, navigator: { onLine: true }, addEventListener: () => {}, registration: {} });
  for (const file of ["log.js", "config.js", "cache-utils.js", "strategies.js"]) runInNewContext(readFileSync(path.join(SW_DIR, file), "utf8"), sandbox, { filename: file });
  const SWX = sandbox.SWX as { warmAppShellCss: () => Promise<void>; cacheFirst: (r: unknown, c: string) => Promise<Res>; STATIC_CACHE: string };
  return { SWX, store, fetches, Req: RequestCtor };
}

describe("the app-shell stylesheet warm-up for the PWA launch", () => {
  it("reads THIS deploy's stylesheets off /history (revalidated) and caches every one", async () => {
    const { SWX, store, fetches } = load();
    await SWX.warmAppShellCss();
    expect(fetches).toEqual(["/history", ...CSS]);
    for (const href of CSS) expect(store.has(ORIGIN + href)).toBe(true);
  });
  it("🔴 the app page's request for a stylesheet still downloading WAITS on it — one download, not two", async () => {
    const { SWX, fetches, Req } = load({ cssDelayMs: 40 });
    const warm = SWX.warmAppShellCss();
    await new Promise((r) => setTimeout(r, 10)); // the app page arrives mid-download
    const served = await SWX.cacheFirst(new Req(CSS[1]!), SWX.STATIC_CACHE);
    await warm;
    expect(served.body).toBe("body{}");
    expect(fetches.filter((f) => f === CSS[1]).length).toBe(1);
  });
  it("already cached: nothing is downloaded again (a normal launch costs one small revalidation)", async () => {
    const { SWX, fetches } = load();
    await SWX.warmAppShellCss();
    fetches.length = 0;
    await SWX.warmAppShellCss();
    expect(fetches).toEqual(["/history"]);
  });
  it("wired end to end: the worker answers the message, launch.html sends it for a member before navigating", () => {
    expect(readFileSync(path.join(SW_DIR, "lifecycle.js"), "utf8")).toMatch(/event\.data\.type === "frenz-warm-app-shell"[\s\S]{0,120}event\.waitUntil\(SWX\.warmAppShellCss\(\)[.)]/);
    const launch = readFileSync(path.resolve(process.cwd(), "public/launch.html"), "utf8");
    const post = launch.indexOf('postMessage({ type: "frenz-warm-app-shell" }, [ch.port2])');
    expect(post).toBeGreaterThan(0);
    expect(post).toBeLessThan(launch.indexOf("location.replace(next)"));
  });

  /*
    2026-10-31 (owner: "the pwa now shows white screen before the brand logo and loader"): starting the download was
    not enough — the launch screen left one frame later and the app sat blank while a new deploy's stylesheet arrived.
    The worker now answers on the port when it's cached, and launch.html hands off only once painted AND warm (capped).
  */
  const waitsForWarm = (launch: string, lifecycle: string) =>
    /event\.ports\[0\]\.postMessage\("warm"\)/.test(lifecycle) &&
    /ch\.port1\.onmessage = function \(\) \{\s*warmed = true;\s*tryGo\(\);/.test(launch) &&
    /if \(painted && warmed && go\) go\(\);/.test(launch) &&
    /var WARM_CAP_MS = \d{3,4};/.test(launch) &&
    !/requestAnimationFrame\(go\)/.test(launch);
  it("the launch screen stays until the stylesheet is warm, capped so it never hangs", () => {
    const launch = readFileSync(path.resolve(process.cwd(), "public/launch.html"), "utf8");
    const lifecycle = readFileSync(path.join(SW_DIR, "lifecycle.js"), "utf8");
    expect(waitsForWarm(launch, lifecycle)).toBe(true);
    // teeth: handing off on the paint alone again, or a worker that never answers, fails
    expect(waitsForWarm(launch.replace("if (painted && warmed && go) go();", "if (painted && go) go();"), lifecycle)).toBe(false);
    expect(waitsForWarm(launch, lifecycle.replace('event.ports[0].postMessage("warm")', "void 0"))).toBe(false);
    expect(waitsForWarm(launch.replace(/var WARM_CAP_MS = \d+;/, ""), lifecycle)).toBe(false);
  });
});
