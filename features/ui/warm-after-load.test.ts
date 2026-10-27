import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { afterPageLoad } from "@/features/app-shell/warm-routes";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/*
  Owner, 2026-10-26: "the download page and landing page are taking time to load on first load and every load".
  Measured cold on production (Pixel 7, 4x CPU, 1.6 Mbps): the landing's load event at 17.7 s, because six other
  routes (/history, /wallpapers, /quests, /exclusive, /ai, /advertise/campaigns) were prefetched — payload plus
  ~60 JS chunks — WHILE the page was still loading. A warm-up may only start after `load`.
*/

/** A source file whose warm-up can fire before the page has loaded. */
function warmsBeforeLoad(src: string): boolean {
  return /requestIdleCallback\(\s*warm/.test(src) || /setTimeout\(\s*warm/.test(src);
}

/** A plain next/link with Next's default (viewport) prefetch — it fires during load. */
function hasViewportPrefetchLink(src: string): boolean {
  return [...src.matchAll(/<Link\b[^>]*?>/gs)].some((m) => !/prefetch=\{false\}/.test(m[0]));
}

/** The nav's warm-up effect calls router.prefetch on a line BEFORE it hands the rest to afterPageLoad. */
function navPrefetchesAtMount(src: string): boolean {
  const i = src.indexOf("return afterPageLoad(() => {");
  if (i < 0) return true;
  const effectStart = src.lastIndexOf("useEffect(", i);
  return /router\.prefetch\(/.test(src.slice(Math.max(0, effectStart), i));
}

/** A bottom-nav tab drawn without prefetch={false} — Next prefetches it the moment it is on screen, i.e. during load. */
function tabViewportPrefetches(src: string, label: string): boolean {
  const m = src.match(new RegExp(`<NavTab label="${label}"[^>]*>`));
  return !m || !/prefetch=\{false\}/.test(m[0]);
}

describe("route warm-ups wait for the page to load (2026-10-26)", () => {
  it("TapOnceLink's warmOnIdle goes through afterPageLoad", () => {
    const src = code("features/ui/tap-once-link.tsx");
    expect(src).toContain("return afterPageLoad(warm);");
    expect(warmsBeforeLoad(src)).toBe(false);
  });

  it("the landing's tool cards carry no viewport-prefetching Link", () => {
    expect(hasViewportPrefetchLink(code("features/downloads/home-screen.tsx"))).toBe(false);
  });

  // owner 2026-10-27: "Download and landing must load below 2s in slow 4G" — /history was still warmed at mount
  it("the bottom nav prefetches nothing before load — not even History", () => {
    const nav = code("features/app-shell/mobile-nav.tsx");
    expect(navPrefetchesAtMount(nav)).toBe(false);
    // measured 2026-10-27: the History TAB's own viewport prefetch still fired at 4.8 s, before load at 7.7 s
    expect(tabViewportPrefetches(nav, "History")).toBe(false);
  });

  it("teeth: a History tab without prefetch={false} is caught", () => {
    expect(tabViewportPrefetches(`<NavTab label="History" href="/history" onWarm={router.prefetch} />`, "History")).toBe(true);
  });

  it("the guards fail on the shapes that shipped before", () => {
    expect(navPrefetchesAtMount(`    if (routes.includes(FIRST_WARM_ROUTE)) router.prefetch(FIRST_WARM_ROUTE);\n    return afterPageLoad(() => {`)).toBe(true);
    expect(warmsBeforeLoad("const id = w.requestIdleCallback(warm, { timeout: 4000 });")).toBe(true);
    expect(warmsBeforeLoad("const t = window.setTimeout(warm, 2000);")).toBe(true);
    expect(hasViewportPrefetchLink('<Link\n  href="/ai"\n  data-track="ai_clicked"\n>')).toBe(true);
    expect(hasViewportPrefetchLink('<Link href="/ai" prefetch={false}>')).toBe(false);
  });
});

describe("afterPageLoad", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubPage(readyState: DocumentReadyState) {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("document", { readyState });
    vi.stubGlobal("window", {
      addEventListener: (t: string, cb: () => void) => (listeners[t] = cb),
      removeEventListener: (t: string) => delete listeners[t],
      requestIdleCallback: (cb: () => void) => (cb(), 1),
      cancelIdleCallback: () => {},
    });
    return listeners;
  }

  it("does nothing while the page is loading, then runs once on load", () => {
    const listeners = stubPage("loading");
    const fn = vi.fn();
    afterPageLoad(fn);
    expect(fn).not.toHaveBeenCalled();
    listeners.load!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs at once when the page has already loaded (a client-side navigation)", () => {
    stubPage("complete");
    const fn = vi.fn();
    afterPageLoad(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a cancel before load means it never runs", () => {
    const listeners = stubPage("loading");
    const fn = vi.fn();
    afterPageLoad(fn)();
    expect(listeners.load).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });
});
