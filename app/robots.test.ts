import { describe, expect, it } from "vitest";

import { APP_ONLY_PREFIXES } from "@/lib/auth/app-only-paths";
import { SITE_URL } from "@/lib/site";

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
  it("disallows the API, the admin, the AI tools and every app-only route — nothing else", () => {
    const star = rules.find((r) => r.userAgent === "*");
    expect(star?.disallow).toEqual(["/api/", "/admin/", "/ai", "/ai/", ...APP_ONLY_PREFIXES.flatMap((p) => [`${p}$`, `${p}/`])]);
  });
  it("never blocks the public pages, the platform pages or /_next/ assets (teeth: a blocking rule would fail)", () => {
    const star = rules.find((r) => r.userAgent === "*");
    const disallow = (Array.isArray(star?.disallow) ? star.disallow : [star?.disallow]).map(String);
    // Google's matching: a rule is a path prefix, unless it ends in `$`, which anchors it to the end of the path
    const blocked = (path: string) => disallow.some((d) => (d.endsWith("$") ? path === d.slice(0, -1) : path.startsWith(d)));
    for (const path of ["/", "/about", "/blog/x", "/learn/x", "/wallpapers", "/tiktok-video-downloader", "/frenz-ai", "/unsubscribe", "/_next/static/chunks/main.js"]) {
      expect(blocked(path), path).toBe(false);
    }
    for (const path of ["/home", "/reels", "/explore", "/u", "/u/chris", "/sounds", "/account/security", "/advertise/campaigns"]) {
      expect(blocked(path), path).toBe(true);
    }
  });
  it("points at the one public sitemap", () => {
    expect(out.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});
