/*
  What OPENS the outstream player?

  It is loaded and deliberately shut: `readyState: 4`, a real 19s 1280x720
  creative, `paused: true`, and `max-height: 0` on their `_effect` div — through
  14 seconds, through a real scroll, with and without height on our container.

  A `max-height: 0` that is meant to animate open is driven by a CLASS their
  script adds. So read their own stylesheet: find every rule mentioning the
  effect wrapper, and the class name whose rule carries a non-zero max-height.
  That name is the condition, and it is the only thing that can say whether this
  is ours to fix or theirs.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();
const tag = cfg.exoclickHistory;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(2000);

await page.evaluate(
  async ({ cls, zoneId, src }) => {
    const host = document.createElement("div");
    host.id = "__css";
    host.style.width = "100%";
    document.body.insertBefore(host, document.body.firstChild);
    const ins = document.createElement("ins");
    ins.className = cls;
    ins.setAttribute("data-zoneid", zoneId);
    host.appendChild(ins);
    await new Promise((resolve) => {
      const el = document.createElement("script");
      el.async = true;
      el.src = src;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
    try {
      (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
    } catch {
      /* the push is the ask */
    }
  },
  { cls: tag.cls, zoneId: tag.zoneId, src: tag.src },
);
await page.waitForTimeout(9000);

const out = await page.evaluate(() => {
  const host = document.getElementById("__css");
  const css = [...host.querySelectorAll("style")].map((s) => s.textContent).join("\n");

  // Every rule that mentions the effect wrapper or a max-height.
  const rules = css
    .split("}")
    .map((r) => (r + "}").replace(/\s+/g, " ").trim())
    .filter((r) => /_effect|max-height|outstream|_open|sticky|_close/i.test(r));

  const eff = host.querySelector("[class*='_effect']");
  const main = host.querySelector("[class*='_main_outstream']");
  return {
    effectClass: eff?.className ?? null,
    mainClass: main?.className ?? null,
    // Class lists on the whole chain, so an added state class is visible.
    chain: (() => {
      const out = [];
      let el = host.querySelector("video");
      while (el && el !== host) {
        out.unshift(`${el.tagName}.${(el.className || "").toString().trim()}`);
        el = el.parentElement;
      }
      return out;
    })(),
    rules: rules.slice(0, 40),
    cssLen: css.length,
  };
});

console.log(`injected CSS: ${out.cssLen} bytes`);
console.log(`\n-- element chain from host down to <video> --`);
for (const c of out.chain) console.log(`  ${c}`);
console.log(`\n-- rules mentioning _effect / max-height / open --`);
for (const r of out.rules) console.log(`  ${r}`);

await browser.close();
