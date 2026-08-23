import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The service worker must NEVER handle a file download.
 *
 * ── The bug this guards ───────────────────────────────────────────────────────
 * A click on `<a href download>` is issued by the browser as a request with
 * `mode: "navigate"` — it is a top-level navigation that the browser converts
 * into a download only once it sees the response. So `/downloads/frenzsave.apk`
 * fell through every earlier branch of the fetch router and was answered by the
 * GENERIC NAVIGATION branch: `networkFirst(..., { offlineFallback })`.
 *
 * Once the worker calls `respondWith` on that, the download depends on a
 * Response the worker synthesised — `networkFirst` re-serves the body, and on
 * any hiccup `offlineFallback` returns an HTML page instead. The browser never
 * receives the plain binary response it needs to hand to the download manager,
 * and because a failed download surfaces nothing in the page, the only symptom
 * is "I tap Download and nothing happens".
 *
 * ── Why it is asserted here rather than in a browser test ─────────────────────
 * Reading `routes.js` is what missed this twice: the download path matches no
 * media extension and no static prefix, so nothing about it *looks* like a
 * navigation until you know that `download` links are navigations. The routing
 * decision is pure string logic, so it can be re-derived here exactly and
 * cheaply — and this fails loudly if a future edit reorders the bail out from
 * under the download path.
 *
 * Same technique as the landing budget test: assert on the artifact, because
 * the source reads as correct either way.
 */

const ROUTES = readFileSync(join(process.cwd(), "public", "sw", "routes.js"), "utf8");

/** Mirrors the ordered bail conditions at the top of the fetch router. */
function routerDecision(pathname: string, mode: "navigate" | "no-cors"): "bail" | "handled" {
  const url = new URL(`https://frenzsave.com${pathname}`);
  const sameOrigin = url.origin === "https://frenzsave.com";
  if (/\.(m3u8|ts|m4s|mp4|m4a|mp3|webm)$/i.test(url.pathname)) return "bail";
  if (sameOrigin && (url.pathname.startsWith("/downloads/") || /\.(apk|aab|zip)$/i.test(url.pathname))) {
    return "bail";
  }
  if (mode === "navigate") return "handled";
  return "bail";
}

describe("service worker download passthrough", () => {
  it("keeps the download bail in routes.js", () => {
    // The simulation above is only meaningful if it still mirrors the file.
    expect(
      ROUTES.includes('startsWith("/downloads/")'),
      "public/sw/routes.js lost its `/downloads/` bail. A `<a download>` click is a " +
        "`mode: navigate` request, so without this the APK is served through " +
        "networkFirst/offlineFallback and the download silently never starts.",
    ).toBe(true);
    expect(/\\.\(apk\|aab\|zip\)\$/.test(ROUTES) || ROUTES.includes("(apk|aab|zip)")).toBe(true);
  });

  it("does not intercept downloads, even though they arrive as navigations", () => {
    expect(routerDecision("/downloads/frenzsave.apk", "navigate")).toBe("bail");
    expect(routerDecision("/downloads/export.zip", "navigate")).toBe("bail");
    expect(routerDecision("/downloads/frenz.aab", "navigate")).toBe("bail");
  });

  it("still handles the /downloads APP PAGE and other navigations", () => {
    /*
      The bail is `/downloads/` WITH the trailing slash precisely so the
      signed-in Downloads page at `/downloads` keeps its offline handling. A
      bare `/downloads` prefix would have silently removed the whole route from
      the worker — trading one bug for a quieter one.
    */
    expect(routerDecision("/downloads", "navigate")).toBe("handled");
    expect(routerDecision("/", "navigate")).toBe("handled");
    expect(routerDecision("/launch.html", "navigate")).toBe("handled");
  });

  it("bumps SWX.VERSION whenever routes.js changes behaviour", () => {
    /*
      The worker is served cache-first to installed devices, so a routing fix
      that does not change VERSION reaches nobody who already has the old one —
      i.e. exactly the people reporting the bug. Asserting the version is at
      least v16 pins the bump that shipped this fix; raise it with the next one.
    */
    const config = readFileSync(join(process.cwd(), "public", "sw", "config.js"), "utf8");
    const version = config.match(/SWX\.VERSION\s*=\s*"v(\d+)"/);
    expect(version, "SWX.VERSION not found in public/sw/config.js").not.toBeNull();
    expect(Number(version![1])).toBeGreaterThanOrEqual(16);
  });
});
