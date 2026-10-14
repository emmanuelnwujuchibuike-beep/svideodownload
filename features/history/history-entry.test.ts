import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HISTORY_THUMB_CACHE } from "./thumb-keep";

/* Owner, 2026-10-14: the History white flash, a loader when nothing is
   prefetched, and thumbnails that stop reloading on every visit. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("History opens without a white flash", () => {
  it("does not fade in from transparent on a tap", () => {
    expect(src("features/app-shell/page-transition.tsx")).toContain('if (pathname === "/history") return true;');
  });

  it("shows the header and the stripe while an unprefetched payload loads", () => {
    const p = "app/(marketing)/history/loading.tsx";
    expect(existsSync(join(process.cwd(), p))).toBe(true);
    expect(src(p)).toContain("<PageLoaderWithHeader desktop />");
    expect(src(p)).toContain("bg-background");
  });
});

describe("a cold load hydrates without throwing the page away", () => {
  it("entitlements render the server's answer during hydration (React #418 on /history)", () => {
    const e = src("features/auth/use-entitlements.ts");
    expect(e).toContain("const hydrating = useSyncExternalStore(noopSubscribe, notHydrating, isHydrating);");
    expect(e).toContain("if (hydrating) return { ...FREE, ready: false };");
    // the server snapshot is the hydrating one — swapped, the guard would do nothing
    expect(e).toContain("const isHydrating = () => true;");
    expect(e).toContain("const notHydrating = () => false;");
  });
});

describe("History thumbnails are kept on the device", () => {
  const config = src("public/sw/config.js");

  it("the page and the worker name the same cache", () => {
    expect(config).toContain(`SWX.HISTORY_THUMB_CACHE = "${HISTORY_THUMB_CACHE}";`);
  });

  it("the worker keeps it across activations", () => {
    expect(/SWX\.KEEP = \[[^\]]*SWX\.HISTORY_THUMB_CACHE[^\]]*\]/.test(config)).toBe(true);
  });

  it("sign-out deletes it — its name carries the prefix sign-out clears", () => {
    const prefix = /n\.startsWith\("(frenz-img-)"\)/.exec(src("lib/auth/sign-out.ts"))?.[1];
    expect(prefix).toBe("frenz-img-");
    expect(HISTORY_THUMB_CACHE.startsWith(prefix!)).toBe(true);
  });

  it("images are answered from it before the shared image cache", () => {
    const routes = src("public/sw/routes.js");
    const kept = routes.indexOf("SWX.fromHistoryThumbs(req)");
    expect(kept).toBeGreaterThan(-1);
    expect(kept).toBeLessThan(routes.indexOf("SWX.staleWhileRevalidate(req, SWX.IMAGE_CACHE)"));
    expect(src("public/sw/strategies.js")).toContain("SWX.fromHistoryThumbs = async function");
  });

  it("both history tile kinds keep their thumbnail once it loads", () => {
    expect(src("features/history/media-gallery.tsx").match(/onLoaded=\{keepHistoryThumb\}/g)?.length).toBe(2);
  });

  it("the worker version moved with it, in both files the browser diffs", () => {
    expect(config).toContain('SWX.VERSION = "v30";');
    expect(src("public/sw.js")).toContain("Frenz service worker v30");
  });

  it("/history stays out of the shared page cache (it is listed private)", () => {
    expect(config).not.toMatch(/PAGE_CACHE_ALLOWLIST_EXACT = \[[^\]]*"\/history"/);
  });
});
