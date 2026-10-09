import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * WHERE THE STREAK CHIP IS ALLOWED TO APPEAR.
 *
 * Owner, 2026-10-09: "move the streak that is next to the avatar in the message
 * page to the profile page." The gate is ownership: the only call site is the
 * owner hero of app/u/[handle]/page.tsx, which the server renders only for the
 * profile's owner. A source-integrity test, because both properties — the one
 * call site and its absence everywhere else — survive any passing render.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SRC = code("features/streaks/streak-header-chip.tsx");
const PROFILE = code("app/u/[handle]/page.tsx");

describe("the chip lives on your own profile, nowhere else", () => {
  it("is mounted once, inside the owner branch, under your handle", () => {
    const owner = PROFILE.indexOf("if (profile.isOwner) {");
    const chip = PROFILE.indexOf('<StreakHeaderChip className="mt-2" />');
    expect(owner).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(owner);
    expect(PROFILE.match(/<StreakHeaderChip/g)).toHaveLength(1);
    // inside the owner hero: after the owner's @handle, before the visitor layout's
    const handle = PROFILE.indexOf('<p className="mt-0.5 text-muted-foreground">@{profile.handle}</p>');
    expect(handle).toBeGreaterThan(owner);
    expect(chip).toBeGreaterThan(handle);
    expect(chip).toBeLessThan(PROFILE.indexOf('<p className="mt-0.5 text-muted-foreground">@{profile.handle}</p>', handle + 1));
  });

  it("is gone from the message page and the shell headers", () => {
    for (const f of [
      "features/social/inbox-mobile-chrome.tsx",
      "app/(app)/messages/layout.tsx",
      "components/layout/site-header.tsx",
      "features/app-shell/app-topbar.tsx",
    ]) expect(code(f), f).not.toContain("<StreakHeaderChip");
  });

  it("keeps the hooks in their own component", () => {
    expect(SRC).toMatch(/function StreakChip\(/);
    expect(SRC).toMatch(/return <StreakChip className=\{className\} \/>;/);
    expect(SRC).not.toContain("usePathname");
  });
});

describe("a visitor with no streak", () => {
  it("still renders nothing, so the header cannot shift", () => {
    // Zero-CLS discipline: the pill either paints in the first client render
    // from the localStorage cache, or never. It must not appear when a fetch
    // resolves — that is a layout shift in a header, above the fold, on every
    // route that carries it.
    expect(SRC).toContain("if (streak <= 0) return null;");
    expect(SRC).toContain("readDisplayCache()");
  });
});
