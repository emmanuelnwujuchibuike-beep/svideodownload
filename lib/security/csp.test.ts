import { describe, expect, it } from "vitest";

import { buildCsp } from "../../next.config";

/**
 * Ad revenue is the platform's key income (owner, 2026-07-16: "make sure the
 * ads revenue and anything related from ads is not blocked — cross check
 * twice"). The CSP became ENFORCING that day, which means this file is now the
 * only thing standing between a one-line directive edit and ads silently
 * earning nothing — a banner blocked by CSP renders EMPTY, throws no visible
 * error, and would surface as a slow revenue decline nobody traces back here.
 *
 * The first enforcing policy really did contain three such breakages, all found
 * by that cross-check and all pinned below:
 *   1. frame-src  — display banners render in an <iframe srcdoc> (ad-slot.tsx),
 *      which INHERITS this policy; ad networks nest a further iframe for the
 *      creative, whose origin was not allowlisted.
 *   2. font-src   — unspecified, so it fell back to `default-src 'self'` and
 *      blocked webfonts pulled by injected social-bar/native formats.
 *   3. style-src  — had no `https:`, blocking the external stylesheet Adsterra's
 *      Social Bar injects.
 *
 * Each `it()` below maps to a real resource an ad format needs. If one fails,
 * do NOT relax the test — the policy is about to cost money.
 */

function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found ?? "";
}

describe("enforced CSP — ad revenue must never be blocked", () => {
  const csp = buildCsp("enforce");

  it("allows external ad network scripts, inline embeds, and their eval()", () => {
    // injectAdMarkup recreates <script> nodes from admin-configured markup:
    // external src, inline bodies, and ad SDKs commonly eval().
    const d = directive(csp, "script-src");
    expect(d).toContain("https:");
    expect(d).toContain("'unsafe-inline'");
    expect(d).toContain("'unsafe-eval'");
  });

  it("allows ad iframes from any network — the srcdoc display-banner path", () => {
    const d = directive(csp, "frame-src");
    expect(d).toContain("https:");
    expect(d).toContain("blob:");
  });

  it("allows ad stylesheets (Social Bar injects an external <link>)", () => {
    expect(directive(csp, "style-src")).toContain("https:");
  });

  it("allows ad webfonts — font-src must be explicit, not fall back to default-src", () => {
    const d = directive(csp, "font-src");
    expect(d).not.toBe("");
    expect(d).toContain("https:");
  });

  it("allows ad creatives, tracking pixels and video", () => {
    expect(directive(csp, "img-src")).toContain("https:");
    expect(directive(csp, "img-src")).toContain("data:");
    expect(directive(csp, "media-src")).toContain("https:");
  });

  it("allows ad tracking/impression beacons and sockets", () => {
    const d = directive(csp, "connect-src");
    expect(d).toContain("https:");
    expect(d).toContain("wss:");
  });

  it("allows blob: workers — nothing ships one today, but a fallback to default-src would break one silently", () => {
    expect(directive(csp, "worker-src")).toContain("blob:");
  });

  it("mirrors frame-src into child-src so a legacy engine can't be the one thing that blocks an ad frame", () => {
    expect(directive(csp, "child-src")).toContain("https:");
  });
});

describe("enforced CSP — what it still genuinely blocks", () => {
  const csp = buildCsp("enforce");

  it("blocks off-origin form posts — an injected form can't exfiltrate a password/OTP", () => {
    // The single most valuable enforced directive for this app, and safe for
    // every configured ad format: popunder/social-bar/native clicks are
    // window.open or link navigations, which form-action does NOT govern.
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });

  it("blocks <base> hijacking of every relative URL on the page", () => {
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
  });

  it("blocks plugin/embed injection", () => {
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
  });

  it("still refuses to be framed by others (clickjacking) even though we may frame ads", () => {
    // frame-ancestors (who may frame US) is a different axis from frame-src
    // (who WE may frame) — widening the latter for ads must never touch this.
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
  });
});

describe("report-only CSP — the stricter target we're gathering evidence for", () => {
  it("keeps script-src strict so violations enumerate the real ad origins to allowlist", () => {
    const d = directive(buildCsp("report"), "script-src");
    expect(d).not.toContain("https:");
    expect(d).not.toContain("'unsafe-eval'");
  });

  it("reports but never blocks — it must never be the enforced header", () => {
    // Guards the wiring in next.config's headers(): report-only and enforce are
    // two DIFFERENT policies. If they ever became identical, we'd either lose
    // the evidence trail or start enforcing the strict script-src and kill ads.
    expect(buildCsp("report")).not.toBe(buildCsp("enforce"));
  });
});
