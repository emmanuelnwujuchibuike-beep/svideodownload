import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-27: "the pwa now shows more white screen and not the Brand loader", and the download page "loads like
 * a signed out user then takes a few seconds to login" — both from `experimental.inlineCss`, tried and reverted the
 * same day. It put the whole stylesheet (~478 kB) into every document's <head>, AHEAD of the boot F loader, and a
 * document is not cached the way /_next/static CSS is: every launch of the installed app re-downloaded and parsed it
 * before the loader could paint, and the loader no longer covered the moment before the account loads.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

export function inlinesCss(config: string): boolean {
  return /^\s*inlineCss\s*:\s*true/m.test(config);
}

describe("the stylesheet stays a separate, cached file", () => {
  it("next.config does not inline CSS into the HTML", () => {
    expect(inlinesCss(src("next.config.ts"))).toBe(false);
  });
  it("teeth: turning it back on is caught", () => {
    expect(inlinesCss("  experimental: {\n    inlineCss: true,\n  },")).toBe(true);
  });
});

describe("Friends page header (owner, 2026-10-27)", () => {
  const hub = src("features/friends/friends-hub.tsx");
  it("the top-right button is Friends & requests (friends + sent requests), not search — search is on Add friends", () => {
    expect(hub).toContain("<PeopleSheet");
    expect(hub).not.toContain('aria-label="Search friends" className={ROUND}');
  });
  it("Add friends is warmed after load and on press, never during the page's own load", () => {
    expect(hub).toContain("useEffect(() => afterPageLoad(() => router.prefetch(DISCOVER)), [router]);");
    expect(hub).toContain("onPointerDown={warmDiscover}");
  });
});
