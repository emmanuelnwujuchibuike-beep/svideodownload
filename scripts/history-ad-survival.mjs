/*
  Does a SERVED creative survive our own component?

  This is the end-to-end check the ad work has never had. The zone sweep proved
  ExoClick returns a real `outstream_video` for zone 6015606; the creative dump
  proved the markup lands in our host. Neither says whether OUR code then leaves
  it alone — and the evidence says it did not:

    • `hasCreative()` was `host.offsetHeight > 0`, false for a creative that has
      not painted yet and false forever for one that is `position: fixed`;
    • the 3.5s retry runs on that verdict and calls `el.textContent = ""`;
    • the re-ask is frequency-capped, so the slot goes empty and stays empty.

  Which is exactly "the history above the grid still disappear after viewing ones
  ... it only reshow when I refresh".

  So this mounts the REAL page with the REAL component and samples the host
  across the 3.5s retry and the 10s empty-beacon, looking for the moment it is
  taken away. `/history` renders its gallery only when there is history, so the
  visitor's own localStorage is seeded first — the same shape `features/history/
  store.ts` writes (`svd:history:v1`).
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";

const now = Date.now();
const HISTORY = Array.from({ length: 6 }, (_, i) => ({
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

// Seed on the real origin, then reload so the store reads it at boot.
await page.goto(`${BASE}/history`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.evaluate((items) => {
  window.localStorage.setItem("svd:history:v1", JSON.stringify(items));
}, HISTORY);
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });

const SAMPLE = () => {
  const ins = document.querySelector("ins[data-zoneid]");
  if (!ins) return { ins: false };
  const host = ins.parentElement;
  const r = host.getBoundingClientRect();
  const media = host.querySelectorAll("iframe, video, img, canvas, object, embed, a[href]").length;
  let painted = 0;
  for (const el of host.querySelectorAll("*")) {
    const b = el.getBoundingClientRect();
    if (b.width >= 20 && b.height >= 20) painted++;
  }
  return {
    ins: true,
    zone: ins.getAttribute("data-zoneid"),
    processed: ins.getAttribute("data-processed"),
    hostW: Math.round(r.width),
    hostH: Math.round(r.height),
    htmlLen: host.innerHTML.length,
    media,
    painted,
  };
};

console.log(`${BASE}/history — seeded ${HISTORY.length} history records\n`);
const seen = [];
for (const t of [1500, 3000, 4500, 6000, 9000, 13000]) {
  await page.waitForTimeout(t - (seen.at(-1)?.t ?? 0));
  const s = await page.evaluate(SAMPLE);
  seen.push({ t, ...s });
  if (!s.ins) {
    console.log(`  t=${String(t).padStart(5)}ms  no <ins> in the document`);
    continue;
  }
  console.log(
    `  t=${String(t).padStart(5)}ms  zone=${s.zone} host=${s.hostW}x${s.hostH} html=${String(s.htmlLen).padStart(6)} media=${s.media} painted=${s.painted} processed=${s.processed}`,
  );
}

const withMarkup = seen.filter((s) => s.ins && s.htmlLen > 1000);
const first = withMarkup[0];
const last = seen.at(-1);

console.log("");
if (!first) {
  console.log("🟠 the zone never delivered markup in this run — nothing to survive (network-side)");
} else if (last.ins && last.htmlLen > 1000) {
  console.log(`🟢 CREATIVE SURVIVED: markup arrived by t=${first.t}ms and is still present at t=${last.t}ms`);
} else {
  console.log(
    `🔴 CREATIVE WAS DESTROYED: ${first.htmlLen} bytes at t=${first.t}ms -> ${last.htmlLen ?? 0} at t=${last.t}ms. Our retry wiped it.`,
  );
}

await browser.close();
