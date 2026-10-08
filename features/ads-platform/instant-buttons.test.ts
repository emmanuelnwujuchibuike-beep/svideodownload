import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-08: "make the buttons in the promote page respond instantly … show
 * the button loading like the earn button … that button system should cover for
 * all server side buttons in the promote and advertise pages."
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const ADVERTISING_FILES = [
  "app/(marketing)/advertise/page.tsx",
  "app/(marketing)/advertise/rules/page.tsx",
  "features/ads-platform/payment-return.tsx",
  "features/ads-platform/my-campaigns.tsx",
  "components/landing/ecosystem.tsx",
];

describe("every advertising button answers the first tap", () => {
  it("no AiButtonLink to an advertising page without tapOnce", () => {
    for (const f of ADVERTISING_FILES) {
      const s = src(f);
      expect(s, f).not.toMatch(/<AiButtonLink href="\/advertise/);
    }
  });

  it("no plain next/link left on the advertising pages, except the rules link that opens a new tab", () => {
    for (const f of ["app/(marketing)/advertise/page.tsx", "features/ads-platform/payment-return.tsx", "features/ads-platform/my-campaigns.tsx"]) {
      expect(src(f), f).not.toMatch(/<Link[\s>]/);
    }
    const wiz = src("features/ads-platform/advertise-wizard.tsx");
    expect(wiz.match(/<Link[\s>]/g) ?? []).toHaveLength(1);
    expect(wiz).toContain('<Link href="/advertise/rules" target="_blank"');
    expect(src("features/downloads/promote-card.tsx")).toContain("<TapOnceLink");
  });

  it("AiButtonLink's tapOnce is the Earn button's TapOnceLink, with its pending look", () => {
    const b = src("features/ai/design/ai-button.tsx");
    expect(b).toContain("<TapOnceLink {...rest} href={rest.href}");
    expect(b).toContain('"data-[pending]:opacity-80"');
  });

  it("the wizard's server actions show they are working", () => {
    const wiz = src("features/ads-platform/advertise-wizard.tsx");
    expect(wiz).toContain('{busy === "save" ? "Saving…" : "Save draft"}');
    expect(wiz).toContain('{busy === "discard" ? "Discarding…" : "Discard"}');
  });
});
