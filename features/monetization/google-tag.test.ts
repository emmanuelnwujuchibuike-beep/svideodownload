import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-19: GA stats inaccurate and unbalanced. Measured cause: gtag.js was lazyOnload, so on a phone the
 * first page_view left 9–26 s after the visit began and short visits were never counted. Pinned: the loader is
 * injected at the first idle moment after hydration (≤ 2 s) or when the page is hidden — never after the load event.
 */
const src = readFileSync(join(process.cwd(), "features/monetization/google-tag.tsx"), "utf8");

function rules(s: string) {
  return {
    initAfterHydration: s.includes('<Script id="frenz-gtag-init" strategy="afterInteractive">') && s.includes("gtag('config','${id}');"),
    idleLoader: s.includes("requestIdleCallback(load,{timeout:2000})"),
    loadsOnLeave: s.includes("if(document.visibilityState==='hidden')load();") && s.includes("addEventListener('pagehide',load);"),
    notAfterLoad: !/strategy="lazyOnload"/.test(s),
  };
}

describe("the Google tag counts every visit", () => {
  it("loads gtag.js at the first idle moment, or when the visitor leaves — never after the load event", () => {
    expect(rules(src)).toEqual({ initAfterHydration: true, idleLoader: true, loadsOnLeave: true, notAfterLoad: true });
  });
  it("teeth: going back to lazyOnload, or dropping the leave hook, is caught", () => {
    expect(rules(src + '\n<Script strategy="lazyOnload" />').notAfterLoad).toBe(false);
    expect(rules(src.replace("addEventListener('pagehide',load);", "")).loadsOnLeave).toBe(false);
  });
});
