import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

describe("safeNext — no open redirect after sign-in", () => {
  it("keeps a same-site path, with its query and hash", () => {
    expect(safeNext("/u/ada?tab=sub")).toBe("/u/ada?tab=sub");
    expect(safeNext("/members#top")).toBe("/members#top");
    expect(safeNext("/rewards")).toBe("/rewards");
  });

  it("refuses every shape that leaves the site", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "@evil.com", "evil.com", "javascript:alert(1)", "/\u0000x", " //evil.com", "/%0d%0aSet-Cookie:x", "\\\\evil.com"]) {
      const out = safeNext(bad, "/home");
      expect(out.startsWith("/") && !out.startsWith("//"), bad).toBe(true);
      expect(new URL(out, "https://frenzsave.com").host, bad).toBe("frenzsave.com");
    }
    expect(safeNext("@evil.com")).toBe("/home");
    expect(safeNext("//evil.com")).toBe("/home");
    expect(safeNext(undefined, "/account")).toBe("/account");
    expect(safeNext("/" + "a".repeat(600))).toBe("/home");
  });

  it("every consumer of ?next= goes through it", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    for (const f of ["app/login/page.tsx", "app/login/mfa-challenge/page.tsx", "app/auth/callback/route.ts", "features/auth/auth-panel.tsx"]) {
      expect(src(f), f).toContain("safeNext(");
    }
  });
});
