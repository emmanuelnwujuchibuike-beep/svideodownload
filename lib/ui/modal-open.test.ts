import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { anotherModalOpen } from "./modal-open";

const dialog = (visible: boolean) => ({ getClientRects: () => (visible ? [{}] : []) });
const setDom = (els: unknown[]) => {
  (globalThis as { document?: unknown }).document = { querySelectorAll: () => els };
};
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("one full-screen dialog at a time (owner, 2026-10-10: two interstitials stacked)", () => {
  it("a visible modal dialog blocks another; a hidden one or the caller itself does not", () => {
    const visible = dialog(true);
    setDom([visible]);
    expect(anotherModalOpen()).toBe(true);
    expect(anotherModalOpen(visible as unknown as Element)).toBe(false);
    setDom([dialog(false)]);
    expect(anotherModalOpen()).toBe(false);
  });

  it("teeth: both full-screen moments ask before they open", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(src("features/ads-platform/serve/self-moments.tsx")).toContain("if (busy.current || anotherModalOpen()) return null;");
    const trigger = src("features/rewards/referral-banner-trigger.tsx");
    expect(trigger).toContain("const adOpen = () => anotherModalOpen();");
    // blocked for a minute: skip, never fall through to setShow(true) on top of it
    expect(trigger).toMatch(/if \(adOpen\(\)\) \{[\s\S]*?return;\s*\}/);
  });
});
