import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_PUBLIC_PATHS, isGuardedAiPath } from "@/lib/auth/ai-public-paths";

/**
 * Owner, 2026-10-05: a guest may see the Frenz AI welcome page and nothing
 * else. The failure that matters is the WIDE one — a prefix match that quietly
 * opens every tool — so most of these cases are tools that must stay shut.
 */
describe("only the Frenz AI welcome page is open to guests", () => {
  it("opens exactly /ai", () => {
    expect(isGuardedAiPath("/ai")).toBe(false);
    expect([...AI_PUBLIC_PATHS]).toEqual(["/ai"]);
  });

  it("keeps every tool behind the sign-in", () => {
    for (const p of [
      "/ai/",
      "/ai/text-to-video",
      "/ai/image-to-video",
      "/ai/lip-sync",
      "/ai/text-to-audio",
      "/ai/voice-cloning",
      "/ai/history",
      "/ai/usage",
      "/ai/character-replace",
      "/ai/character-replace/create",
      "/aix",
    ]) {
      expect(isGuardedAiPath(p), p).toBe(true);
    }
  });

  it("is what middleware actually calls", () => {
    const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
    expect(mw).toContain("isGuardedAiPath(path) ||");
    // the old blanket guard must not survive beside it, or /ai is shut again
    expect(mw).not.toContain('path.startsWith("/ai") ||');
  });
});
