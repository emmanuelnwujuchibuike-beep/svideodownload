import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pickNextNoRepeat } from "./rotation";

/**
 * Owner, 2026-10-09: "Make all ad format to rotate 10, top banner rotates every
 * 15 seconds or everytime the user comes back to the app. And reward, Download
 * result, completed, and others should rotate on every download." (0205)
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("0205 rotation rules", () => {
  const m = code("supabase/migrations/0205_ad_rotation_rules.sql");
  it("every format has a 10-slot pool; the top banner swaps every 15 s; the result card has no timer", () => {
    expect(m).toContain("update public.ad_formats set slot_count = 10, updated_at = now() where slot_count is distinct from 10;");
    expect(m).toContain("update public.ad_formats set rotation_seconds = 15, updated_at = now() where code = 'TOP_BANNER';");
    expect(m).toContain("update public.ad_formats set rotation_seconds = null, no_consecutive_repeat = true, updated_at = now() where code = 'DOWNLOAD_RESULT_BANNER';");
    for (const q of m.match(/'[^']*'/g) ?? []) expect(q).not.toContain(";");
  });

  const banner = code("features/ads-platform/serve/self-ad-banner.tsx");
  it("coming back to the app moves a timed banner on", () => {
    expect(banner).toMatch(/if \(document\.visibilityState === "visible"\) \{\s*\/\/[^\n]*\n\s*setIndex\(\(i\) => \(i \+ 1\) % count\);/);
  });
  it("a per-show banner starts after the one shown last and records what it showed", () => {
    expect(banner).toContain("const pick = nextFromPool(placement, ads.filter((a) => !creativeFailed(a.cr)));");
    expect(banner).toContain("recordShown(placement, current.cr);");
  });
  it("the last-shown ad is remembered across visits (every download, not every session)", () => {
    const s = code("lib/ads-platform/serving-state.ts");
    expect(s).toContain("const raw = localStorage.getItem(LAST_KEY);");
    expect(s).toContain("localStorage.setItem(LAST_KEY, JSON.stringify(all));");
    expect(s).not.toMatch(/sessionStorage\.(get|set)Item\(LAST_KEY/);
  });

  it("ten downloads walk the whole pool of ten, never repeating back to back", () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ cr: `ad${i}` }));
    let last: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const next: { cr: string } = pickNextNoRepeat(pool, last, () => 0)!;
      expect(next.cr).not.toBe(last);
      seen.add(next.cr);
      last = next.cr;
    }
    expect(seen.size).toBe(10);
  });
  it("teeth: a picker that ignores the last ad repeats it", () => {
    const pool = [{ cr: "a" }, { cr: "b" }];
    const naive = (p: typeof pool) => p[0]!;
    expect(naive(pool).cr).toBe(pickNextNoRepeat(pool, null, () => 0)!.cr);
    expect(pickNextNoRepeat(pool, "a", () => 0)!.cr).toBe("b");
  });
});
