import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Landing brief §31 (2026-10-08): the install card never covers a CTA or the home bar. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("install card placement", () => {
  it("clears the bottom nav plus the safe-area inset", () => {
    expect(src("features/notifications/ios-install-prompt.tsx")).toContain("bottom-[calc(5rem+env(safe-area-inset-bottom))]");
  });

  it("stays off the ad application and payment pages", () => {
    const s = src("features/notifications/ios-install-prompt.tsx");
    expect(s).toContain('p.startsWith("/advertise/create")');
    expect(s).toContain('p.startsWith("/advertise/payment")');
  });

  it("is mounted only in the app shell, never over the landing or /advertise CTAs", () => {
    expect(src("app/(app)/layout.tsx")).toContain("<AppOverlays />");
    expect(src("app/(marketing)/layout.tsx")).not.toContain("AppOverlays");
  });
});
