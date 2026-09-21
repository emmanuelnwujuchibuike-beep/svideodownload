import { describe, expect, it } from "vitest";

import robots from "./robots";

/**
 * 2026-09-20 — AdSense said "ads.txt not found" for days and the owner
 * suspected the /ai rule. The live file answered 200 to Google's own user
 * agents throughout; this pins that robots.txt can never be the reason.
 */
describe("robots.txt never stands between a Google crawler and ads.txt", () => {
  const out = robots();
  const rules = Array.isArray(out.rules) ? out.rules : [out.rules];
  it("every group allows /ads.txt by name and never disallows a prefix of it", () => {
    for (const rule of rules) {
      const allow = Array.isArray(rule.allow) ? rule.allow : [rule.allow];
      const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
      expect(allow, String(rule.userAgent)).toContain("/ads.txt");
      for (const d of disallow) expect("/ads.txt".startsWith(String(d)), `${rule.userAgent} disallows ${d}`).toBe(false);
    }
  });
  it("no Google search or AdSense crawler is named in a disallow group", () => {
    const named = rules.flatMap((r) => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]));
    for (const ua of ["Googlebot", "Mediapartners-Google", "AdsBot-Google", "Googlebot-Image", "Googlebot-Video"]) expect(named).not.toContain(ua);
  });
  it("the only disallowed paths are the API, the admin and (for now) the AI pages", () => {
    const star = rules.find((r) => r.userAgent === "*");
    expect(star?.disallow).toEqual(["/api/", "/admin/", "/ai", "/ai/"]);
  });
});
