import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/* Owner, 2026-10-14: "my railway always show native tiktok fail then it use the
   fall back tikwm". Native's reason was only logged when BOTH routes failed. */
const src = readFileSync(join(process.cwd(), "server/extractors/tiktok.ts"), "utf8");

describe("every TikTok fetch logs how each route did", () => {
  it("native's failure reason and time are logged even when TikWM answers", () => {
    expect(src).toContain('console.warn("[tiktok] native failed", { ms: Date.now() - t0, reason:');
    expect(src).toContain('console.info("[tiktok] native ok", { ms: Date.now() - t0');
    expect(src).toContain('console.warn("[tiktok] tikwm failed", { ms: Date.now() - t0, reason:');
    expect(src).toContain('console.info("[tiktok] tikwm ok", { ms: Date.now() - t0');
  });

  it("a native timeout names our own deadline", () => {
    expect(src).toContain("TikTok page timed out after ${TIKTOK_TIMEOUT_MS}ms");
  });
});
