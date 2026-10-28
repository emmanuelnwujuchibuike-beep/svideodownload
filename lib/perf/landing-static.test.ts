import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

import { describe, expect, it } from "vitest";

import { LANDING_CSS, minifyCss } from "@/lib/landing-static/css";
import { renderLanding } from "@/lib/landing-static/html";

/**
 * The static landing page's budget (owner brief 2026-10-27, §1 hard limits) — on the REAL artifact: the document
 * app/route.ts serves and the scripts it loads, compressed the way the CDN serves them (Brotli). Fails the test run
 * (and so the build check) the moment the page goes over. The runtime rules (§3) are pinned on the source.
 *
 *   HTML + inline CSS ≤ 20 KB · CSS ≤ 15 KB · first-view JS ≤ 20 KB · fonts 0 · no Google Fonts · no image above the
 *   fold · ≤ 4 requests before first paint (the document; the module script is deferred) · no endless animation,
 *   no rAF loop, no setInterval, no scroll listener · only transform/opacity animated
 */
const br = (s: string | Buffer) => brotliCompressSync(typeof s === "string" ? Buffer.from(s) : s, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
const html = renderLanding({ siteUrl: "https://frenzsave.com", jsVersion: "test", downloadOrigin: "https://svideodownload-worker-production.up.railway.app", direct: true, googleTagId: "G-ABCDEF1234" });
const js = (f: string) => readFileSync(join(process.cwd(), "public", "landing", f), "utf8");
const KB = 1024;

describe("the static landing's byte budget", () => {
  it("HTML with its inline CSS: ≤ 20 KB compressed", () => {
    expect(br(html)).toBeLessThanOrEqual(20 * KB);
  });
  it("CSS: ≤ 15 KB compressed, all inline (no stylesheet request)", () => {
    expect(br(minifyCss(LANDING_CSS))).toBeLessThanOrEqual(15 * KB);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  });
  it("first-view JS (core.js only — the rest is imported on use): ≤ 20 KB compressed; even all four together are", () => {
    expect(br(js("core.js"))).toBeLessThanOrEqual(20 * KB);
    expect(br(js("core.js") + js("result.js") + js("sheets.js") + js("extras.js"))).toBeLessThanOrEqual(20 * KB);
  });
  it("fonts: none — the system font; no Google Fonts request anywhere", () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@font-face|\.woff2?/);
    expect(LANDING_CSS).toMatch(/-apple-system,BlinkMacSystemFont/);
  });
  it("requests before first paint: the document only — one deferred module script, no blocking script, no image above the fold", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    const external = head.match(/<script[^>]+src=/g) ?? [];
    expect(external).toHaveLength(1);
    expect(head).toMatch(/<script type="module" src="\/landing\/core\.js\?v=/);
    const firstScreen = html.slice(html.indexOf("<body"), html.indexOf('id="how"'));
    expect(firstScreen).not.toMatch(/<img\b/);
  });
  it("the headline (the LCP element) and the download box are in the HTML, not drawn by script", () => {
    expect(html).toContain('<h1><span>Save.</span> <span class="grad">Discover.</span> <span>Create and earn.</span></h1>');
    expect(html).toContain('<form class="dl" id="dlForm" novalidate>');
  });
  it("teeth: the budget check does fail on an over-budget page", () => {
    const padded = html + "<!--" + Array.from({ length: 40_000 }, (_, i) => (i * 2654435761 % 4294967296).toString(36)).join("") + "-->";
    expect(br(padded)).toBeGreaterThan(20 * KB);
  });
});

describe("the page's look rules (design tokens kept, expensive effects swapped — brief §4)", () => {
  it("light mode is pure white, the pressed-in well is #F4F5F8", () => {
    expect(LANDING_CSS).toMatch(/--ground:#FFFFFF/);
    expect(LANDING_CSS).toMatch(/--well:#F4F5F8/);
  });
  it("backdrop blur only on the header, the tab bar, an open sheet and a showing toast — inside @supports, 16px max", () => {
    const blurred = [...LANDING_CSS.matchAll(/([^{}]+)\{[^{}]*backdrop-filter:var\(--blur\)/g)].map((m) => m[1]!.trim());
    for (const sel of blurred) expect(sel).toMatch(/^(\.header|\.tabs|dialog\[open\]|\.toast\.show)$/);
    expect(LANDING_CSS).toMatch(/--blur:blur\(16px\)/);
    expect(LANDING_CSS).not.toMatch(/\.cap\{[^}]*backdrop-filter/);
    expect(LANDING_CSS).not.toMatch(/\.prompt\{[^}]*backdrop-filter/);
  });
  it("nothing animates box-shadow, filter or size — only transform and opacity", () => {
    for (const m of LANDING_CSS.matchAll(/transition:([^;}]+)/g)) expect(m[1]).not.toMatch(/box-shadow|filter|width|height|top|left|background/);
    for (const m of LANDING_CSS.matchAll(/@keyframes [a-z]+\{([^@]+?)\}\}/g)) expect(m[1]).not.toMatch(/box-shadow|filter|width|height/);
  });
  it("the AI card's caret blinks a fixed number of times, and only when core.js marks it on screen", () => {
    expect(LANDING_CSS).toMatch(/\.run \.prompt \.caret\{animation:blink 1s steps\(1\) 8\}/);
    expect(LANDING_CSS).not.toMatch(/blink[^;}]*infinite/);
  });
  it("Reduce Motion, Reduce Transparency and Save-Data are honoured", () => {
    expect(LANDING_CSS).toMatch(/prefers-reduced-motion:reduce/);
    expect(LANDING_CSS).toMatch(/prefers-reduced-transparency:reduce/);
    expect(LANDING_CSS).toMatch(/\.save-data /);
  });
});

describe("never overheat (brief §3) — read from the scripts", () => {
  const all = ["core.js", "result.js", "sheets.js", "extras.js"].map(js).join("\n");
  it("no rAF loop, no setInterval, no scroll listener", () => {
    expect(all).not.toMatch(/requestAnimationFrame|setInterval\(|addEventListener\(["']scroll/);
  });
  it("one reveal observer that un-observes each element; the caret stops when the tab is hidden", () => {
    expect(js("core.js")).toMatch(/io\.unobserve\(en\.target\)/);
    expect(js("core.js")).toMatch(/visibilitychange/);
  });
  it("third parties (analytics, ads) and the service worker load only after load + idle, never in front of first paint", () => {
    expect(js("core.js")).toMatch(/addEventListener\("load", later/);
    expect(js("core.js")).toMatch(/requestIdleCallback/);
    expect(html).not.toMatch(/googletagmanager|monetag|hilltop|adsbygoogle/i);
  });
  it("the download flow: one request at a time, a timeout, one retry, the real API", () => {
    const r = js("result.js");
    expect(js("core.js")).toMatch(/if \(running\) return;/);
    expect(r).toMatch(/const TIMEOUT = 30000/);
    expect(r).toMatch(/one automatic retry/);
    expect(r).toContain('"/api/metadata"');
    expect(r).toContain('"/api/download?"');
    expect(r).not.toMatch(/MOCK|setTimeout\(\(\) => \{\s*dlBtn/);
  });
  it("a top-quality file behind the admin's reward ad is never saved from here — it goes to the full downloader", () => {
    const r = js("result.js");
    expect(r).toMatch(/needsAdWith\(g, o\)/);
    // decided inside the tap (the config is read when the result appears): an await first would lose the gesture
    expect(r).toMatch(/const gateReady = gateConfig\(\)/);
    expect(r).toContain("hdDownloadNetwork");
    expect(r).toMatch(/location\.assign\(full\)/);
  });
});

describe("content kept (brief §5, §6)", () => {
  it("real platforms from lib/platforms.ts, real dates in What's new, SEO tags and structured data", () => {
    expect(html).not.toContain("[DATE]");
    expect(html).toMatch(/<time datetime="2026-09-07">/);
    expect(html).toContain('"hosts"'.slice(0, 0) + "tiktok.com");
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/frenzsave\.com\/">/);
    expect(html).toMatch(/<meta property="og:image"/);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).not.toMatch(/Tumblr/); // the design's placeholder list is gone: only what the backend supports
    // YouTube: recognised (its links work) but never listed (lib/platforms.ts SHOWCASE_PLATFORMS — the AdSense rule)
    const listed = html.slice(0, html.indexOf('<script type="application/json" id="ld-data">'));
    expect(listed).not.toMatch(/>YouTube</);
    expect(html.slice(html.indexOf('id="ld-data"'))).toContain("youtube.com");
  });
  it("no third-party characters in the artwork; the logo is an inline SVG", () => {
    expect(html).not.toMatch(/kirby/i);
    expect(html).toMatch(/<a href="#top" class="logo"[^>]*><svg/);
  });
});
