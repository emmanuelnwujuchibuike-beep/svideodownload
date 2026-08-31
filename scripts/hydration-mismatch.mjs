/**
 * Find WHAT is mismatching during hydration.
 *
 * Production only tells you `Minified React error #418`. React's development
 * build prints the actual server-vs-client diff and the component stack, which
 * is the only practical way to locate the offending node — so this points at a
 * `next dev` server ON PURPOSE.
 *
 * ⚠️ Dev for DIAGNOSIS, never for timing: this project has a standing note that
 * dev hydration timings are an artifact (unminified React, no bundling, HMR
 * runtime). Numbers come from scripts/interaction-ab.mjs against `next start`.
 *
 *   node scripts/hydration-mismatch.mjs http://localhost:3125/
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3125/";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

// Third parties add noise and can navigate the page away mid-run.
await page.route("**/*", (route) => {
  const host = new URL(route.request().url()).hostname;
  return host === "localhost" || host === "127.0.0.1" ? route.continue() : route.abort();
});

const interesting = [];
page.on("console", (m) => {
  const text = m.text();
  if (
    /hydrat|did not match|mismatch|server.*client|#418|#419|#423|#425|Warning: (Text|Expected|Prop)/i.test(
      text,
    )
  ) {
    interesting.push({ type: m.type(), text });
  }
});
page.on("pageerror", (e) => interesting.push({ type: "pageerror", text: String(e) }));

await page.goto(URL_, { waitUntil: "load", timeout: 120_000 });
await page.waitForTimeout(8000);
await browser.close();

if (!interesting.length) {
  console.log("No hydration warnings captured.");
} else {
  console.log(`${interesting.length} hydration-related message(s):\n`);
  for (const m of interesting) {
    console.log("─".repeat(78));
    console.log(`[${m.type}]`);
    // These messages are long and the component stack at the end is the useful
    // half, so print generously rather than truncating to a preview.
    console.log(m.text.slice(0, 4000));
  }
}
