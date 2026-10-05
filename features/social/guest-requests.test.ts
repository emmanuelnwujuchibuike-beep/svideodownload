import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GUEST_WARM_ROUTES, SIDEBAR_GUEST_WARM_ROUTES } from "@/features/app-shell/warm-routes";
import { loadInbox } from "@/features/social/inbox";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/**
 * Owner, 2026-10-05: requests "without being used" are the cost. Measured on a
 * production build, an idle SIGNED-OUT landing view made `/api/messages` (the
 * nav's unread badge) and warmed five member-only routes — `/account` and
 * `/studio/ai/history` bounce to /login, `/home` `/friends` `/messages` are
 * private no-store renders a guest never has a tab for.
 */

function withCookies(jar: string) {
  vi.stubGlobal("document", { cookie: jar });
}

afterEach(() => vi.unstubAllGlobals());

describe("hasAuthCookie — the one session test", () => {
  it("absent cookie ⇒ signed out; any Supabase auth cookie (incl. a chunk) ⇒ ask the server", () => {
    withCookies("");
    expect(hasAuthCookie()).toBe(false);
    withCookies("theme=dark; frenz_sid=abc");
    expect(hasAuthCookie()).toBe(false);
    withCookies("theme=dark; sb-wmimm-auth-token=base64-xyz");
    expect(hasAuthCookie()).toBe(true);
    withCookies("sb-wmimm-auth-token.0=base64-a; sb-wmimm-auth-token.1=b");
    expect(hasAuthCookie()).toBe(true);
  });

  it("a sandboxed embed that THROWS on document.cookie reads as signed out, not a crash", () => {
    vi.stubGlobal("document", {
      get cookie(): string {
        throw new Error("SecurityError");
      },
    });
    expect(hasAuthCookie()).toBe(false);
  });
});

describe("loadInbox — no request for a guest", () => {
  it("guest: empty inbox and NO /api/messages request", async () => {
    withCookies("");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(loadInbox()).resolves.toEqual({ conversations: [], unread: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("member: asks the server exactly as before", async () => {
    withCookies("sb-x-auth-token=v");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ conversations: [], unread: 3 })));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(loadInbox()).resolves.toEqual({ conversations: [], unread: 3 });
    expect(fetchSpy).toHaveBeenCalledWith("/api/messages");
  });
});

describe("nav idle warm-up — a guest warms only public tabs", () => {
  it("the desktop sidebar (mounted, hidden, on phones too) picks its guest list the same way", () => {
    const src = readFileSync(join(process.cwd(), "features/app-shell/app-sidebar.tsx"), "utf8");
    // Exact substrings, not regexes: a regex with an unescaped `||` is an
    // alternation with an EMPTY branch and matches anything — the first
    // version of these assertions did exactly that and could not fail.
    expect(src).toContain("const member = !!handle || hasAuthCookie();");
    expect(src).toContain(": SIDEBAR_GUEST_WARM_ROUTES;");
  });

  it("the member Home tab and the header logo never prefetch \"/\" before the handle is known", () => {
    const nav = readFileSync(join(process.cwd(), "features/app-shell/mobile-nav.tsx"), "utf8");
    const header = readFileSync(join(process.cwd(), "components/layout/site-header.tsx"), "utf8");
    expect(nav).toContain("prefetch={handle || !hasAuthCookie() ? undefined : false}");
    expect(header).toContain("const homePrefetch = handle || !hasAuthCookie() ? undefined : false;");
    expect(header).toContain("<Link href={homeHref} prefetch={homePrefetch}");
  });

  const MEMBER_ONLY = ["/home", "/friends", "/messages", "/account", "/studio/ai/history"];

  it("the guest lists hold no member-only route", () => {
    for (const r of [...GUEST_WARM_ROUTES, ...SIDEBAR_GUEST_WARM_ROUTES]) expect(MEMBER_ONLY, r).not.toContain(r);
    expect(GUEST_WARM_ROUTES.length).toBeGreaterThan(0);
  });

  it("the warm-up picks the guest list when there is no handle and no session cookie", () => {
    const src = readFileSync(join(process.cwd(), "features/app-shell/mobile-nav.tsx"), "utf8");
    expect(src).toMatch(/const member = !!handle \|\| hasAuthCookie\(\);/);
    expect(src).toMatch(/const routes = member\s*\?\s*\[[^\]]*\]\s*:\s*GUEST_WARM_ROUTES;/);
    // The member list is unchanged — still the owner's eight.
    expect(src).toMatch(/\["\/home", "\/friends", "\/messages", "\/feed", "\/account", "\/history", "\/studio\/ai\/history", profileHref\]/);
  });
});
