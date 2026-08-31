/**
 * Asserts, against a RUNNING SERVER, that the Supabase client is not part of a
 * page's first-load JavaScript — i.e. that it is not fetched before the primary
 * button becomes interactive.
 *
 * ── Why this drives a real browser ───────────────────────────────────────────
 * Two cheaper checks were tried first and BOTH gave the wrong answer:
 *
 *  • Reading `.next/app-build-manifest.json` for the page entry said the landing
 *    was clean while the browser was still downloading 60 kB of Supabase — the
 *    page entry is only one of several chunk groups the document loads.
 *  • Grepping the served HTML for chunk URLs over-counts, because the inline
 *    flight data names chunks for client components that are never fetched.
 *
 * Chunk hashes and numeric ids also differ between builds, so nothing that
 * compares file NAMES across two builds proves anything. What costs a visitor
 * time is bytes on the wire before the page answers a tap, so that is what this
 * measures: actual network responses, up to the moment the button is live.
 *
 *   node scripts/verify-no-supabase.mjs http://localhost:3123/
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";

// Fingerprints of the runtime itself, never the word "supabase" — a project URL
// or a comment mentioning it must not fail this check.
const FINGERPRINTS = ["gotrue_meta_security", "_acquireLock", "SupabaseClient", "RealtimeClient", "PostgrestClient"];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const fetched = [];
page.on("response", async (r) => {
  if (!r.url().includes("/_next/static/chunks/")) return;
  let body = "";
  try {
    body = await r.text();
  } catch {
    return;
  }
  fetched.push({
    name: r.url().split("/chunks/")[1],
    bytes: body.length,
    hit: FINGERPRINTS.filter((f) => body.includes(f)),
  });
});

await page.goto(URL_, { waitUntil: "commit", timeout: 60_000 });

// Stop at the moment the primary CTA is genuinely interactive: anything after
// that is not part of the dead-tap window.
const deadline = Date.now() + 25_000;
while (Date.now() < deadline) {
  const live = await page
    .evaluate(() => {
      const el = document.querySelector('button[type="submit"], form button');
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    })
    .catch(() => false);
  if (live) break;
  await page.waitForTimeout(50);
}

await browser.close();

const total = fetched.reduce((a, r) => a + r.bytes, 0);
const guilty = fetched.filter((r) => r.hit.length);

console.log(URL_);
console.log(`  JS chunks fetched before the button was interactive: ${fetched.length}`);
console.log(`  uncompressed JS on the wire in that window:          ${(total / 1024).toFixed(0)} kB`);
if (guilty.length) {
  console.log(`  ❌ SUPABASE fetched before interactive, in ${guilty.length} chunk(s):`);
  for (const g of guilty) console.log(`     ${g.name}  ${(g.bytes / 1024).toFixed(0)} kB  [${g.hit.join(", ")}]`);
  process.exitCode = 1;
} else {
  console.log(`  ✅ no Supabase client fetched before the button was interactive`);
}
