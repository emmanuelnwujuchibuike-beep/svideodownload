/*
  Their open condition, read out of ad-provider.js, and tested against it.

      function c(){
        if(!o.classList.contains("exo_wrapper_show") && W() && (
            a = t.offsetWidth,
            p = Math.ceil(a * videoHeight / videoWidth / 2),   // half scaled height
            u = window.innerHeight,
            m = Math.ceil(video.getBoundingClientRect().top),
            f = atBottom() ? m : m + p,
            m > 0 && f < u
        ) && n) { …add exo_wrapper_show… }
      }
      window.addEventListener("scroll", c); // + resize, focus, blur, visibilitychange

  Two things follow, and they invalidate every outstream probe run so far:

    1. `m > 0` is STRICT. A slot whose top is exactly 0 — which is what
       `document.body.insertBefore(host, body.firstChild)` plus `scrollTo(0,0)`
       produces, and what every previous probe did — can NEVER open.
    2. `c` runs on scroll/resize/focus. It is not polled. A slot that is already
       in place on load gets no evaluation until something moves.

  So this walks the real page: seed history, load /history where the unit sits
  below the header (top > 0), then scroll in small steps and report `top`,
  `top + halfHeight`, the viewport height and whether the class appeared — so the
  arithmetic is visible next to the outcome rather than inferred from it.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const now = Date.now();
const HISTORY = Array.from({ length: 8 }, (_, i) => ({
  id: `probe-${i}`,
  url: `https://www.tiktok.com/@probe/video/${1000 + i}`,
  platform: "tiktok",
  platformName: "TikTok",
  title: `Probe clip ${i + 1}`,
  thumbnail: null,
  formatId: "mp4-720",
  kind: i % 2 === 0 ? "video" : "image",
  qualityLabel: "720p",
  createdAt: now - i * 3_600_000,
  favorite: false,
}));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

await page.goto(`${BASE}/history`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.evaluate((items) => window.localStorage.setItem("svd:history:v1", JSON.stringify(items)), HISTORY);
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(6000);

const READ = () =>
  page.evaluate(() => {
    const ins = [...document.querySelectorAll("ins[data-zoneid]")].find((i) =>
      /37$/.test(i.className),
    );
    const host = ins?.parentElement;
    const eff = host?.querySelector("[class*='_effect']");
    const v = host?.querySelector("video");
    if (!v || !eff) return { ready: false, ins: !!ins, html: host?.innerHTML.length ?? 0 };
    const top = Math.ceil(v.getBoundingClientRect().top);
    const width = eff.parentElement?.offsetWidth ?? 0;
    const half = v.videoWidth ? Math.ceil((width * v.videoHeight) / v.videoWidth / 2) : 0;
    const vh = Math.ceil(window.innerHeight);
    return {
      ready: true,
      top,
      half,
      f: top + half,
      vh,
      passesM: top > 0,
      passesF: top + half < vh,
      show: /exo_wrapper_show/.test(eff.className),
      hostH: Math.round(host.getBoundingClientRect().height),
      paused: v.paused,
      scrollY: Math.round(window.scrollY),
    };
  });

console.log(`${BASE}/history — real layout, stepping the scroll\n`);
console.log(`  ${"scrollY".padStart(7)} ${"top".padStart(6)} ${"+half".padStart(6)} ${"vh".padStart(5)}  m>0   f<vh  show  hostH`);

let opened = false;
for (let step = 0; step < 14; step++) {
  const s = await READ();
  if (!s.ready) {
    console.log(`  (player not ready yet: ins=${s.ins} html=${s.html})`);
  } else {
    console.log(
      `  ${String(s.scrollY).padStart(7)} ${String(s.top).padStart(6)} ${String(s.f).padStart(6)} ${String(s.vh).padStart(5)}  ${s.passesM ? "yes" : "NO "}   ${s.passesF ? "yes" : "NO "}   ${s.show ? "🟢" : "no"}   ${s.hostH}`,
    );
    if (s.show) {
      opened = true;
      break;
    }
  }
  await page.mouse.wheel(0, step < 7 ? 120 : -120);
  await page.waitForTimeout(700);
}

const final = await READ();
console.log("");
if (opened || final.show) {
  console.log(`🟢 OUTSTREAM OPENED — host is ${final.hostH}px, video paused=${final.paused}`);
} else {
  console.log(`🔴 never opened. last: top=${final.top} f=${final.f} vh=${final.vh} m>0=${final.passesM} f<vh=${final.passesF}`);
}
await page.screenshot({ path: "scripts/.outstream.png" });
await browser.close();
