/**
 * Is the In-Page Push script we inject carrying the zone Monetag expects?
 *
 * Owner, 2026-09-03: impressions "stuck at 19 for hours" while two creatives are
 * visibly rendering in their own screenshot. Delivery clearly works, so the
 * question is ATTRIBUTION: a loader that serves but reports against the wrong
 * zone (or no zone) looks exactly like this.
 */
import { chromium, devices } from "playwright";

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();

const reqs = [];
p.on("request", (r) => {
  const u = r.url();
  if (/nap5k|n6wxm|highperformanceformat/i.test(u)) reqs.push(u);
});

await p.goto("https://frenzsave.com/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
for (let i = 0; i < 5; i++) {
  await p.mouse.wheel(0, 700);
  await p.waitForTimeout(400);
}
await p.waitForTimeout(14000);

const tags = await p.evaluate(() =>
  [
    ...document.querySelectorAll(
      "script[data-monetag], script[data-monetag-moment], script[data-monetag-prearm]",
    ),
  ].map((s) => ({
    src: s.getAttribute("src"),
    format: s.getAttribute("data-monetag"),
    moment: s.getAttribute("data-monetag-moment") ?? s.getAttribute("data-monetag-prearm"),
    zone: s.getAttribute("data-zone"),
    cfasync: s.getAttribute("data-cfasync"),
  })),
);

console.log("── injected Monetag <script> tags");
for (const t of tags) console.log(" ", JSON.stringify(t));
if (tags.length === 0) console.log("  (none — the tag never injected on this view)");

console.log("\n── requests to Monetag hosts");
for (const u of reqs) console.log("  " + u.slice(0, 150));
if (reqs.length === 0) console.log("  (none)");

await b.close();
