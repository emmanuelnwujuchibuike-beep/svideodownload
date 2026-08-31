/*
  Ground truth for "the ad is not showing", taken from PRODUCTION.

  🔴 WHY THIS HAS TO RUN AGAINST frenzsave.com AND NOT localhost.

  ExoClick serves against an AUTHORISED REFERER. Every request from localhost is
  declined with "has no ads to display" no matter what our markup does — so a
  local run cannot tell a broken container from an empty network, and every
  local verdict so far has been that same non-answer read as a diagnosis.

  This separates the two questions that kept getting confused:

    1. GEOMETRY — is our host a box an ad could live in? Measurable regardless
       of whether anything fills it, and true or false on its own terms.
    2. DEMAND   — did their loader ask, and what came back? Read from their OWN
       console output and their OWN network responses, not inferred from pixels.

  A slot can fail either one. Reporting them separately is the point.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";

/** Their loader announces every ask and every verdict on the console. */
const EXO_HOSTS = ["magsrv.com", "pemsrv.com", "exdynsrv.com", "realsrv.com", "exoclick.com"];

function isExo(url) {
  return EXO_HOSTS.some((h) => url.includes(h));
}

/**
 * Measure every ExoClick host on the page.
 *
 * Reports the HOST (our div), its parent's display, and whether the loader's
 * sibling wrapper actually holds anything with paint. `offsetWidth === 0` is the
 * finding that matters: a zero-width container cannot render a creative that
 * sizes itself to its parent, and it looks exactly like a no-fill.
 */
const MEASURE = () => {
  const out = [];
  for (const ins of document.querySelectorAll("ins[data-zoneid]")) {
    const host = ins.parentElement;
    if (!host) continue;
    const hr = host.getBoundingClientRect();
    const ps = host.parentElement ? getComputedStyle(host.parentElement) : null;
    // Anything the loader put BESIDE the <ins> — the creative lives there.
    const siblings = [...host.children].filter((c) => c !== ins);
    const painted = siblings.filter((c) => c.getBoundingClientRect().height > 0);
    out.push({
      zone: ins.getAttribute("data-zoneid"),
      cls: ins.className,
      processed: ins.getAttribute("data-processed"),
      hostW: Math.round(hr.width),
      hostH: Math.round(hr.height),
      hostDisplay: getComputedStyle(host).display,
      parentDisplay: ps ? ps.display : null,
      parentW: host.parentElement ? Math.round(host.parentElement.getBoundingClientRect().width) : null,
      siblingCount: siblings.length,
      siblingTags: siblings.map((c) => c.tagName),
      paintedSiblings: painted.length,
      innerHTMLLen: host.innerHTML.length,
    });
  }
  return out;
};

async function probe(browser, path) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  const logs = [];
  const net = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/exo|zone|ad|placement|request/i.test(t)) logs.push(t.slice(0, 300));
  });
  page.on("requestfailed", (r) => {
    if (isExo(r.url())) net.push(`FAILED ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`);
  });
  page.on("response", async (r) => {
    if (!isExo(r.url())) return;
    let body = "";
    try {
      const b = await r.body();
      body = b.toString("utf8").slice(0, 200).replace(/\s+/g, " ");
    } catch {
      body = "<unreadable>";
    }
    net.push(`${r.status()} ${r.url().slice(0, 140)} :: ${body}`);
  });

  const url = `${BASE}${path}`;
  console.log(`\n${"=".repeat(72)}\n${url}\n${"=".repeat(72)}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    console.log(`  NAV FAILED: ${e.message}`);
    await ctx.close();
    return;
  }

  // Scroll down: the docked bar only reveals on a downward scroll, and lazy
  // furniture waits for it too.
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(6000);

  const units = await page.evaluate(MEASURE);
  const hasProvider = await page.evaluate(
    () => [...document.querySelectorAll("script[src]")].filter((s) => /magsrv|pemsrv|exdynsrv/.test(s.src)).map((s) => s.src),
  );

  console.log(`  provider scripts : ${hasProvider.length ? hasProvider.join(", ") : "NONE"}`);
  console.log(`  <ins> found      : ${units.length}`);
  for (const u of units) {
    const verdict =
      u.hostW === 0
        ? "🔴 HOST HAS ZERO WIDTH — nothing can render here"
        : u.paintedSiblings > 0
          ? "🟢 CREATIVE PAINTED"
          : u.processed
            ? "🟠 asked, nothing came back (no fill)"
            : "🟠 never processed by the loader";
    console.log(
      `    zone ${u.zone} [${u.cls}] ${verdict}\n` +
        `      host ${u.hostW}x${u.hostH} display=${u.hostDisplay} | parent display=${u.parentDisplay} w=${u.parentW}\n` +
        `      processed=${u.processed} siblings=${u.siblingCount}${u.siblingTags.length ? ` (${u.siblingTags.join(",")})` : ""} painted=${u.paintedSiblings} htmlLen=${u.innerHTMLLen}`,
    );
  }
  if (logs.length) {
    console.log(`  --- their console (${logs.length}) ---`);
    for (const l of [...new Set(logs)].slice(0, 14)) console.log(`      ${l}`);
  }
  if (net.length) {
    console.log(`  --- their network (${net.length}) ---`);
    for (const n of net.slice(0, 14)) console.log(`      ${n}`);
  }
  await ctx.close();
}

const browser = await chromium.launch();
for (const p of ["/", "/history", "/downloads"]) {
  await probe(browser, p);
}
await browser.close();
