/*
  THREE OF THE FOUR ZONES ARE SERVING. So why is nothing on screen?

  The zone sweep settled the question that mattered: `s.magsrv.com` returns real
  creatives for the outstream, sticky and fullpage zones —

      {"zones":[{"idzone":6015606,"type":"outstream_video", ...
      {"zones":[{"idzone":6016708,"type":"sticky_banner",   ...
      {"zones":[{"idzone":6016704,"type":"mobile_fullpage_interstitial", ...

  — and injects them (15926 / 1384 / 5382 bytes of HTML into our host), yet the
  host measures 0px tall in every case. Only the type-2 BANNER zone genuinely
  answers `zones:[null]`.

  That inverts the whole diagnosis. It is not "the network has nothing"; it is
  that we cannot SEE what the network gave us. And `hasCreative()` is
  `host.offsetHeight > 0`, so a creative that takes itself OUT of flow —
  `position: fixed`, which is exactly what a sticky banner and a fullpage
  interstitial are FOR — leaves the host at 0 and is recorded as a no-fill.

  This dumps what is actually in the host: the real tree, each node's computed
  position/display/size, and where it ended up. No guessing at markup.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const ONLY = process.argv[3]; // optional: a single zone id

const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();
const ZONES = [
  ["history/outstream", cfg.exoclickHistory],
  ["sticky", cfg.exoclickSticky],
  ["interstitial/fullpage", cfg.exoclickInterstitial],
].filter(([, t]) => t?.zoneId && (!ONLY || t.zoneId === ONLY));

const browser = await chromium.launch();

for (const [name, tag] of ZONES) {
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

  const dump = await page.evaluate(
    async ({ cls, zoneId, src }) => {
      const host = document.createElement("div");
      host.style.width = "100%";
      host.setAttribute("data-dump", "");
      document.body.appendChild(host);
      const ins = document.createElement("ins");
      ins.className = cls;
      ins.setAttribute("data-zoneid", zoneId);
      host.appendChild(ins);

      const bodyBefore = new Set(document.body.children);

      await new Promise((resolve) => {
        if ([...document.scripts].some((s) => s.src === src)) return resolve(true);
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
      await new Promise((r) => setTimeout(r, 12_000));

      const describe = (el, depth) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          d: depth,
          tag: el.tagName,
          cls: (el.className || "").toString().slice(0, 60),
          pos: cs.position,
          display: cs.display,
          vis: cs.visibility,
          op: cs.opacity,
          z: cs.zIndex,
          w: Math.round(r.width),
          h: Math.round(r.height),
          top: Math.round(r.top),
          src: (el.getAttribute?.("src") || "").slice(0, 70),
        };
      };
      const walk = (el, depth, out) => {
        if (depth > 4) return out;
        for (const c of el.children) {
          out.push(describe(c, depth));
          walk(c, depth + 1, out);
        }
        return out;
      };

      // Anything the loader attached to BODY instead of our host.
      const escaped = [...document.body.children]
        .filter((c) => !bodyBefore.has(c) && c !== host)
        .map((c) => describe(c, 0));

      return {
        hostRect: (() => {
          const r = host.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        tree: walk(host, 0, []),
        escaped,
        htmlHead: host.innerHTML.slice(0, 700),
      };
    },
    { cls: tag.cls, zoneId: tag.zoneId, src: tag.src },
  );

  console.log(`\n${"=".repeat(74)}\n${name}  zone ${tag.zoneId}  cls ${tag.cls}\n${"=".repeat(74)}`);
  console.log(`host: ${dump.hostRect.w}x${dump.hostRect.h}`);
  console.log(`-- tree inside our host --`);
  for (const n of dump.tree) {
    console.log(
      `${"  ".repeat(n.d + 1)}${n.tag}${n.cls ? "." + n.cls : ""} ${n.w}x${n.h} pos=${n.pos} disp=${n.display} vis=${n.vis} op=${n.op} z=${n.z} top=${n.top}${n.src ? " src=" + n.src : ""}`,
    );
  }
  if (dump.escaped.length) {
    console.log(`-- attached to BODY instead (${dump.escaped.length}) --`);
    for (const n of dump.escaped) {
      console.log(
        `  ${n.tag}${n.cls ? "." + n.cls : ""} ${n.w}x${n.h} pos=${n.pos} disp=${n.display} vis=${n.vis} z=${n.z} top=${n.top}`,
      );
    }
  }
  console.log(`-- html head --\n${dump.htmlHead.replace(/></g, ">\n<")}`);
  await ctx.close();
}

await browser.close();
