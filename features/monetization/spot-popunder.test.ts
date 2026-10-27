import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calledByThirdParty } from "@/lib/monetization/open-observer";
import { DEFAULT_SPOT_POPUNDER, OWNER_POPUNDER_SNIPPET, normalizeSpotPopunder, parseAdsterraSnippet, publicSpotPopunder, spotOutcome } from "@/lib/monetization/spot-popunder";

/**
 * The spot pop-under (owner 2026-10-23), with the Part 2.1 safety rules: OFF unless an admin switched it
 * on; the tag loads on the first press at an enabled spot; other scripts' windows are counted, never
 * blocked (except a pop-under arriving late on a tap whose direct link already opened); the decision is
 * made inside the tap; a blocked popup is not a pop-under; one decision per tap; never both.
 * Driven against the REAL runtime and open observer with a scripted window/document — this proves the
 * logic, NOT real browsers (iOS Safari / Android Chrome checks are manual; see the Part 2.1 report).
 */

let config: Record<string, unknown>;
vi.mock("@/lib/monetization/ads-config-client", () => ({ loadAdsConfig: async () => config }));

interface FakeScript { src?: string; dataset: Record<string, string>; attrs: Record<string, string>; onload?: () => void; onerror?: () => void; setAttribute(k: string, v: string): void }
let scripts: FakeScript[];
let opened: string[];
let browserBlocks: boolean;
let listeners: Map<string, Set<(e: unknown) => void>>;
let store: Map<string, string>;

function installDom() {
  scripts = [];
  opened = [];
  browserBlocks = false;
  listeners = new Map();
  store = new Map();
  spotEls = [visibleSpot("downloadAdClose"), visibleSpot("wallpaper"), visibleSpot("resultPreview")];
  vi.stubGlobal("window", {
    open: (url: string) => {
      if (browserBlocks) return null;
      opened.push(url);
      return {} as Window;
    },
    addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(fn),
    removeEventListener: (t: string, fn: (e: unknown) => void) => void listeners.get(t)?.delete(fn),
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    location: { origin: "https://frenzsave.com", href: "https://frenzsave.com/" },
    innerWidth: 390,
    innerHeight: 844,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  });
  hints = [];
  vi.stubGlobal("document", {
    // <script> tags and the connection hints (<link rel=preconnect>, 2026-10-26) are kept apart
    head: { appendChild: (el: FakeScript & { tag?: string; rel?: string; href?: string }) => void (el.tag === "link" ? hints.push({ rel: el.rel ?? "", href: el.href ?? "" }) : scripts.push(el)) },
    createElement: (tag: string): FakeScript & { tag: string } => ({ tag, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    querySelectorAll: () => spotEls,
  });
}
let hints: { rel: string; href: string }[];
/** the spot elements rendered on the page (visible, inside the viewport); [] = a page with no spot on screen */
let spotEls: { getAttribute: () => string; getBoundingClientRect: () => { width: number; height: number; top: number; left: number; bottom: number; right: number } }[];
const visibleSpot = (spot: string) => ({ getAttribute: () => spot, getBoundingClientRect: () => ({ width: 120, height: 40, top: 300, left: 20, bottom: 340, right: 140 }) });
const fire = (type: string, e: unknown = {}) => [...(listeners.get(type) ?? [])].forEach((fn) => fn(e));
/** a press on an element carrying data-ad-spot={spot} */
const press = (spot: string | null) => fire("pointerdown", { target: { closest: () => (spot ? { getAttribute: () => spot } : null) }, clientX: 0, clientY: 0 });
/** what the pop-under tag does on a click it handles: opens its window (a foreign open) */
const monetagOpens = () => window.open("https://pop.example/ad", "_blank");

const DIRECT = { url: "https://direct.example/go", spots: ["wallpaper", "resultPreview", "downloadAdClose"], chancePercent: 100 };
const ON = { ...DEFAULT_SPOT_POPUNDER, enabled: true };
const POP = publicSpotPopunder(ON, true)!;

async function opener(spot: "wallpaper" | "resultPreview" | "downloadAdClose" = "downloadAdClose") {
  const m = await import("./direct-link-runtime");
  return (await m.loadDirectLinkOpener(spot))!;
}
/** the spot is shown: the tag preloads, and finishes loading */
async function readyOpener() {
  const open = await opener();
  vi.advanceTimersByTime(PRELOAD_MS);
  scripts[0]!.onload!();
  return open;
}
const PRELOAD_MS = 1200;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  installDom();
  config = { monetagDirectLink: DIRECT, monetagSpotPopunder: POP };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Adsterra at the spots (owner, 2026-10-24: \"I want to try adsterra out\") — the admin picks the network", () => {
  const ADSTERRA_CODE = "<script type='text/javascript' src='//pl27012345.profitableratecpm.com/0a/1b/2c/0a1b2c3d4e5f.js'></script>";
  const AON = { ...ON, provider: "adsterra", adsterraSnippet: ADSTERRA_CODE };
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("parses Adsterra's code to an https script address only (protocol-relative becomes https); anything else is refused", () => {
    expect(parseAdsterraSnippet(ADSTERRA_CODE)).toEqual({ src: "https://pl27012345.profitableratecpm.com/0a/1b/2c/0a1b2c3d4e5f.js" });
    expect(parseAdsterraSnippet("<script>alert(1)</script>")).toBeNull();
    expect(parseAdsterraSnippet("<script src='http://x.example/a.js'></script>")).toBeNull();
    expect(parseAdsterraSnippet("<script src='https://x.example/page.html'></script>")).toBeNull();
    expect(parseAdsterraSnippet("")).toBeNull();
  });

  it("🔴 Adsterra is served on its OWN switch + code — never needs the Adsterra banner switch (that would turn banners on too) nor Monetag's", () => {
    expect(publicSpotPopunder(AON, false)).toEqual({ provider: "adsterra", src: "https://pl27012345.profitableratecpm.com/0a/1b/2c/0a1b2c3d4e5f.js", zone: null, cfAsync: false, spots: ["resultPreview", "wallpaper", "rewardAdClose", "downloadAdClose"], spotsOnly: true, cooldownMinutes: 30 });
    expect(publicSpotPopunder(AON, true)).toMatchObject({ provider: "adsterra" });
    expect(publicSpotPopunder({ ...AON, adsterraSnippet: "" }, true)).toBeNull();
    expect(publicSpotPopunder({ ...AON, enabled: false }, true)).toBeNull();
  });

  it("the owner's mix (2026-10-24): Adsterra pop-under + Monetag direct link, Monetag's pop-under tag left unused", () => {
    expect(publicSpotPopunder(AON, true)).toMatchObject({ provider: "adsterra", src: expect.stringContaining("profitableratecpm.com") });
    expect(publicSpotPopunder(AON, true)!.src).not.toContain("al5sm.com");
  });

  it("Monetag stays the pick unless the admin chose Adsterra, and still needs Monetag's switch; a row saved before has no provider", () => {
    expect(publicSpotPopunder(ON, false)).toBeNull();
    expect(normalizeSpotPopunder({ enabled: true }).provider).toBe("monetag");
    expect(normalizeSpotPopunder({ provider: "something" }).provider).toBe("monetag");
    expect(normalizeSpotPopunder({ provider: "adsterra" }).provider).toBe("adsterra");
  });

  it("the runtime labels the tag by network and keeps one set of tap rules; the admin form offers both networks", () => {
    expect(src("features/monetization/direct-link-runtime.ts")).toContain('el.setAttribute(p.provider === "adsterra" ? "data-adsterra" : "data-monetag", "spot_popunder");');
    const admin = src("features/admin/monetization-settings.tsx");
    expect(admin).toContain('<SpotProviderPicker id="spot-popunder-network"');
    // the direct links are separate formats now (Monetag link + Adsterra Smartlink), not a network pick
    expect(admin).not.toContain('<SpotProviderPicker id="direct-link-network"');
    expect(admin).toContain('idPrefix="adsterra-smartlink"');
    const route = src("app/api/admin/monetization/route.ts");
    expect(route).toContain("parseAdsterraSnippet(v) !== null");
    expect(route).toContain('(v.provider === "adsterra" ? v.adsterraSnippet : v.snippet) !== ""');
  });
});

describe("the config — OFF unless an admin switched it on", () => {
  it("default OFF, the owner's zone still pre-filled; nothing is served while off", () => {
    expect(DEFAULT_SPOT_POPUNDER).toEqual({ enabled: false, provider: "monetag", snippet: OWNER_POPUNDER_SNIPPET, adsterraSnippet: "", spots: { download: false, resultPreview: true, wallpaper: true, rewardAdClose: true, downloadAdClose: true, batchSave: false }, spotsOnly: true, cooldownMinutes: 30 });
    expect(publicSpotPopunder(DEFAULT_SPOT_POPUNDER, true)).toBeNull();
    expect(publicSpotPopunder(undefined, true)).toBeNull();
  });
  it("a saved row without the key, or with anything but a literal true, is OFF", () => {
    expect(normalizeSpotPopunder(undefined).enabled).toBe(false);
    expect(normalizeSpotPopunder({}).enabled).toBe(false);
    expect(normalizeSpotPopunder({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeSpotPopunder({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeSpotPopunder({ enabled: true }).enabled).toBe(true);
    expect(normalizeSpotPopunder({ enabled: false }).enabled).toBe(false);
  });
  it("explicitly ON: served with the parsed tag — only with Monetag on, a valid tag and a spot", () => {
    expect(POP).toEqual({ provider: "monetag", src: "https://al5sm.com/tag.min.js", zone: "12054432", cfAsync: false, spots: ["resultPreview", "wallpaper", "rewardAdClose", "downloadAdClose"], spotsOnly: true, cooldownMinutes: 30 });
    expect(publicSpotPopunder(ON, false)).toBeNull();
    expect(publicSpotPopunder({ ...ON, snippet: "<script>alert(1)</script>" }, true)).toBeNull();
    expect(publicSpotPopunder({ ...ON, snippet: "" }, true)).toBeNull();
    expect(publicSpotPopunder({ ...ON, spots: { wallpaper: false, resultPreview: false, adClose: false } }, true)).toBeNull();
  });
  it("the one rule: pop-under wins; else the direct link; never both", () => {
    expect(spotOutcome({ popunderOpened: true, directOpened: true })).toBe("popunder");
    expect(spotOutcome({ popunderOpened: false, directOpened: true })).toBe("direct");
    expect(spotOutcome({ popunderOpened: false, directOpened: false })).toBe("none");
  });
});

describe("connection warm-up (owner, 2026-10-26: 'prefetch the adsterra smartlink and pop under … opens instantly')", () => {
  it("the HOSTS are preconnected before any tap — the direct link's and the pop-under script's — once each", async () => {
    await opener();
    await opener("wallpaper");
    expect(hints).toEqual([
      { rel: "dns-prefetch", href: "https://direct.example" },
      { rel: "preconnect", href: "https://direct.example" },
      { rel: "dns-prefetch", href: "https://al5sm.com" },
      { rel: "preconnect", href: "https://al5sm.com" },
    ]);
  });
  it("🔴 never the ad itself: no request to the link's URL, nothing opened, no script loaded before a tap", async () => {
    await opener();
    expect(hints.every((h) => !h.href.includes("/go"))).toBe(true);
    expect(opened).toEqual([]);
    expect(scripts).toEqual([]);
  });
});

describe("loading — preloaded once an ENABLED spot is shown, so the FIRST tap can open it (owner 2026-10-23)", () => {
  it("not at first paint; shortly after an enabled spot appears; once, however many spots or presses", async () => {
    await opener();
    expect(scripts).toEqual([]);
    vi.advanceTimersByTime(PRELOAD_MS - 1);
    expect(scripts).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ src: "https://al5sm.com/tag.min.js", dataset: { zone: "12054432" } });
    await opener("wallpaper");
    vi.advanceTimersByTime(PRELOAD_MS);
    press("downloadAdClose");
    expect(scripts).toHaveLength(1);
  });
  it("the regression: a page's FIRST tap at the spot opens the pop-under (the tag is ready before it)", async () => {
    const open = await readyOpener();
    const outcome = vi.fn();
    press("downloadAdClose");
    open(outcome);
    monetagOpens();
    fire("click");
    expect(outcome).toHaveBeenCalledWith("popunder");
    expect(opened).toEqual(["https://pop.example/ad"]);
  });
  it("a press before the preload ran still loads it (once)", async () => {
    await opener();
    press("downloadAdClose");
    vi.advanceTimersByTime(PRELOAD_MS);
    expect(scripts).toHaveLength(1);
  });
  it("a spot switched off for the pop-under never loads it there — preload or press", async () => {
    config = { monetagDirectLink: DIRECT, monetagSpotPopunder: { ...POP, spots: ["wallpaper"] } };
    await opener("downloadAdClose");
    vi.advanceTimersByTime(PRELOAD_MS);
    press("downloadAdClose");
    expect(scripts).toEqual([]);
  });
  it("no pop-under configured: nothing ever loads", async () => {
    config = { monetagDirectLink: DIRECT, monetagSpotPopunder: null };
    await opener();
    vi.advanceTimersByTime(PRELOAD_MS);
    expect(scripts).toEqual([]);
  });
  it("the tap that loads the tag (not ready yet) gets the direct link — in the tap, as before", async () => {
    const open = await opener();
    press("downloadAdClose");
    const outcome = vi.fn();
    open(outcome);
    expect(outcome).toHaveBeenCalledWith("direct");
    expect(opened).toEqual(["https://direct.example/go"]);
  });
});

describe("a tap once the pop-under is ready", () => {
  it("the pop-under opened in the tap → it shows; the direct link does NOT", async () => {
    const open = await readyOpener();
    const outcome = vi.fn();
    expect(open(outcome)).toBe(true);
    monetagOpens(); // the tag's own document listener, earlier in this click's path
    fire("click"); // the end of the click's path: the decision, inside the tap
    expect(outcome).toHaveBeenCalledWith("popunder");
    expect(opened).toEqual(["https://pop.example/ad"]);
  });

  it("Monetag skipped this tap → the direct link opens INSIDE the same click (no timer needed)", async () => {
    const open = await readyOpener();
    const outcome = vi.fn();
    open(outcome);
    fire("click");
    expect(outcome).toHaveBeenCalledWith("direct");
    expect(opened).toEqual(["https://direct.example/go"]);
  });

  it("a BLOCKED pop-up (the browser returned null) is not a pop-under → the direct link is tried", async () => {
    const open = await readyOpener();
    const outcome = vi.fn();
    open(outcome);
    browserBlocks = true;
    expect(monetagOpens()).toBeNull();
    browserBlocks = false;
    fire("click");
    expect(outcome).toHaveBeenCalledWith("direct");
    expect(opened).toEqual(["https://direct.example/go"]);
  });

  it("🔴 never both: a pop-under arriving LATE on a tap whose direct link opened is refused", async () => {
    const open = await readyOpener();
    open();
    fire("click");
    expect(monetagOpens()).toBeNull();
    expect(opened).toEqual(["https://direct.example/go"]);
  });

  it("with 'only at these spots' OFF, other scripts' windows are NOT blocked outside that moment (other ads keep working)", async () => {
    config = { monetagDirectLink: DIRECT, monetagSpotPopunder: { ...POP, spotsOnly: false, cooldownMinutes: 0 } };
    const open = await readyOpener();
    monetagOpens(); // a click anywhere, no spot tap involved
    expect(opened).toEqual(["https://pop.example/ad"]);
    open();
    fire("click");
    vi.advanceTimersByTime(1600);
    expect(window.open("https://other-ad.example", "_blank")).not.toBeNull();
  });

  it("two handlers on one tap make ONE decision", async () => {
    const open = await readyOpener();
    open();
    open();
    fire("click");
    vi.runAllTimers();
    expect(opened).toEqual(["https://direct.example/go"]);
  });

  it("a click that never reaches the window (stopped) is decided right after — once", async () => {
    const open = await readyOpener();
    const outcome = vi.fn();
    open(outcome);
    vi.runAllTimers();
    fire("click");
    expect(outcome).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(1);
  });

  it("a pop-under that took the focus (a tab the observer never saw) counts as shown", async () => {
    const open = await readyOpener();
    const outcome = vi.fn();
    open(outcome);
    fire("blur");
    fire("click");
    expect(outcome).toHaveBeenCalledWith("popunder");
    expect(opened).toEqual([]);
  });

  it("the tag failed to load (an ad blocker) → the direct link alone, in the tap", async () => {
    const open = await opener();
    press("downloadAdClose");
    scripts[0]!.onerror!();
    const outcome = vi.fn();
    open(outcome);
    expect(outcome).toHaveBeenCalledWith("direct");
  });

  it("pop-under only (no direct link) and Monetag skipped → nothing opens, outcome none", async () => {
    config = { monetagDirectLink: null, monetagSpotPopunder: POP };
    const open = await readyOpener();
    const outcome = vi.fn();
    open(outcome);
    fire("click");
    expect(outcome).toHaveBeenCalledWith("none");
    expect(opened).toEqual([]);
  });

  it("pop-under OFF (not served): the direct link exactly as before, and no tag ever loads", async () => {
    config = { monetagDirectLink: DIRECT, monetagSpotPopunder: null };
    const open = await opener();
    press("downloadAdClose");
    open();
    expect(scripts).toEqual([]);
    expect(opened).toEqual(["https://direct.example/go"]);
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("every spot element is marked, the config route serves it, settings normalize it, the admin can set it", () => {
    expect(src("features/downloader/preview-card.tsx")).toContain('data-ad-spot="resultPreview"');
    expect(src("features/wallpapers/wallpaper-reels.tsx")).toContain('data-ad-spot="wallpaper"');
    expect(src("features/monetization/download-complete-ad.tsx")).toContain('data-ad-spot="downloadAdClose"');
    expect(src("features/ads-platform/serve/self-interstitial.tsx")).toContain("data-ad-spot={adCloseSpot(reward)}");
    // 2026-10-24: the result card's Download button is its own spot (the download still runs)
    expect(src("features/downloader/preview-card.tsx")).toContain('data-ad-spot="download"');
    expect(src("features/downloader/preview-card.tsx")).toContain('const openDownloadSpot = useDirectLink("download");');
    expect(src("features/monetization/fullscreen-interstitial.tsx")).toContain("data-ad-spot={directLinkSpot}");
    expect(src("app/api/ads/config/route.ts")).toContain("monetagSpotPopunder: publicSpotPopunder(settings.monetagSpotPopunder, settings.monetag === true)");
    // the spots never read the Adsterra BANNER switch
    expect(src("app/api/ads/config/route.ts")).not.toMatch(/publicSpotPopunder\([^)]*settings\.adsterra/);
    expect(src("lib/monetization/settings.ts")).toContain("merged.monetagSpotPopunder = normalizeSpotPopunder(merged.monetagSpotPopunder)");
    expect(src("app/api/admin/monetization/route.ts")).toContain("monetagSpotPopunder: z");
    expect(src("features/admin/monetization-settings.tsx")).toContain("<SpotPopunderEditor");
  });
  it("the runtime never installs the blocking guard; the guard file is as it was", () => {
    const rt = src("features/monetization/direct-link-runtime.ts");
    expect(rt).not.toContain("installPopunderGuard");
    expect(src("lib/monetization/popunder-guard.ts")).not.toContain("revokeWindowOpen");
  });
  it("the close control closes at once after a pop-under (it opens behind), waits for the return after a direct link", () => {
    expect(src("features/monetization/use-direct-link.ts")).toContain('const handled = openDirectLink((outcome) => (outcome === "direct" ? waitForReturn() : close()));');
  });
});

/**
 * What the REAL tag does: Monetag's own script (served from al5sm.com) calls window.open. Compiled with a sourceURL so
 * the call stack names that script exactly as a browser's would — the observer decides from the stack.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const thirdPartyOpen = new Function("u", "return window.open(u, '_blank');\n//# sourceURL=https://al5sm.com/tag.min.js") as (u: string) => Window | null;
/** Our own code (a bundle of this site) opening a window. */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const firstPartyOpen = new Function("u", "return window.open(u, '_blank');\n//# sourceURL=https://frenzsave.com/_next/static/chunks/app.js") as (u: string) => Window | null;
/** An ad's code run from eval with no file name — no script URL in the stack at all. */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const evalOpen = new Function("u", "return window.open(u, '_blank');") as (u: string) => Window | null;

describe("less aggressive (owner 2026-10-23) — fewer pop-unders, the ones that show are normal Monetag impressions", () => {
  it("the caller test: ours ONLY when every script in the stack is ours — eval/blob/inline/no stack count as an ad's", () => {
    expect(calledByThirdParty("Error\n    at y (https://frenzsave.com/_next/static/chunks/1.js:3:9)", "https://frenzsave.com")).toBe(false);
    expect(calledByThirdParty("y@https://frenzsave.com/_next/static/chunks/1.js:3:9", "https://frenzsave.com")).toBe(false); // Safari's format
    expect(calledByThirdParty("Error\n    at x (https://al5sm.com/tag.min.js:1:200)", "https://frenzsave.com")).toBe(true);
    expect(calledByThirdParty("Error\n    at x (https://al5sm.com/a.js:1:2)\n    at y (https://frenzsave.com/_next/1.js:3:9)", "https://frenzsave.com")).toBe(true);
    expect(calledByThirdParty(undefined, "https://frenzsave.com")).toBe(true);
    expect(calledByThirdParty("Error\n    at <anonymous>:1:5\n    at eval (eval at f)", "https://frenzsave.com")).toBe(true);
    expect(calledByThirdParty("Error\n    at x (blob:https://frenzsave.com/1b2c:1:9)", "https://frenzsave.com")).toBe(true);
  });

  it("spots only: Monetag's window on a click ELSEWHERE on the page is refused; at a spot tap it opens", async () => {
    await readyOpener();
    expect(thirdPartyOpen("https://pop.example/elsewhere")).toBeNull();
    expect(opened).toEqual([]);
    press("downloadAdClose");
    expect(thirdPartyOpen("https://pop.example/spot")).not.toBeNull();
    expect(opened).toEqual(["https://pop.example/spot"]);
  });

  it("our own windows (downloads, viewers, notifications — called from our bundles) are never held back, spot or not", async () => {
    await readyOpener();
    expect(firstPartyOpen("https://frenzsave.com/download/1")).not.toBeNull();
    expect(opened).toEqual(["https://frenzsave.com/download/1"]);
  });

  it("🔴 an ad's code with NO script URL in its stack (eval / inline) is held to the spot taps too (owner: 'opens everywhere')", async () => {
    await readyOpener();
    expect(evalOpen("https://pop.example/eval")).toBeNull();
    expect(opened).toEqual([]);
    press("downloadAdClose");
    expect(evalOpen("https://pop.example/at-spot")).not.toBeNull();
  });

  it("the history page (no spot on screen): the tag never loads at all", async () => {
    spotEls = [];
    await opener();
    vi.advanceTimersByTime(PRELOAD_MS * 5);
    expect(scripts).toEqual([]);
  });

  it("a spot element that is mounted but not rendered (zero size, or below the screen) does not load it either", async () => {
    spotEls = [
      { getAttribute: () => "downloadAdClose", getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }) },
      { getAttribute: () => "downloadAdClose", getBoundingClientRect: () => ({ width: 100, height: 40, top: 2000, left: 0, bottom: 2040, right: 100 }) },
    ];
    await opener();
    vi.advanceTimersByTime(PRELOAD_MS * 5);
    expect(scripts).toEqual([]);
  });

  // 2026-10-27 (owner: "smartlink and pop under is not counting … low impression"): inside the cooldown the pop-under is
  // still refused, but the tap gets its BACKUP link — it used to open nothing at all
  it("the cooldown: after a pop-under, the next 30 minutes open no pop-under — the direct link carries those taps; then again", async () => {
    const open = await readyOpener();
    press("downloadAdClose");
    const first = vi.fn();
    open(first);
    thirdPartyOpen("https://pop.example/1");
    fire("click");
    expect(first).toHaveBeenCalledWith("popunder");

    vi.advanceTimersByTime(5 * 60_000);
    press("downloadAdClose");
    const second = vi.fn();
    open(second);
    expect(second).toHaveBeenCalledWith("direct");
    expect(thirdPartyOpen("https://pop.example/2")).toBeNull();
    expect(opened).toEqual(["https://pop.example/1", DIRECT.url]);

    vi.advanceTimersByTime(26 * 60_000);
    press("downloadAdClose");
    const third = vi.fn();
    open(third);
    thirdPartyOpen("https://pop.example/3");
    fire("click");
    expect(third).toHaveBeenCalledWith("popunder");
  });

  it("both off (spots only off, cooldown 0): Monetag behaves exactly as its own tag would", async () => {
    config = { monetagDirectLink: DIRECT, monetagSpotPopunder: { ...POP, spotsOnly: false, cooldownMinutes: 0 } };
    await readyOpener();
    expect(thirdPartyOpen("https://pop.example/a")).not.toBeNull();
    expect(thirdPartyOpen("https://pop.example/b")).not.toBeNull();
  });

  it("settings: a row saved before these existed gets the gentle defaults; values are bounded", () => {
    expect(normalizeSpotPopunder({ enabled: true })).toMatchObject({ spotsOnly: true, cooldownMinutes: 30 });
    expect(normalizeSpotPopunder({ spotsOnly: false, cooldownMinutes: 99999 })).toMatchObject({ spotsOnly: false, cooldownMinutes: 1440 });
    expect(normalizeSpotPopunder({ cooldownMinutes: -5 }).cooldownMinutes).toBe(0);
  });
});
