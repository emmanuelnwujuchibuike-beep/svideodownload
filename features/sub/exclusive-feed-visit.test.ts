import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The Exclusive feed's visit, in the browser (owner, 2026-10-31: "reshuffle … new post shows at the top … resume from where
 * user stop … drag down should be able to reshuffle the exclusive feed"). The order itself is lib/sub/feed-order.ts.
 */
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const feed = code("features/sub/exclusive-feed.tsx");

describe("the Exclusive feed's visit", () => {
  it("pulling down reshuffles — a new seed, the resume dropped, the first page asked again", () => {
    expect(feed).toContain("<PullToRefresh onRefresh={reshuffle}>{feed}</PullToRefresh>");
    const fn = feed.slice(feed.indexOf("const reshuffle = useCallback"), feed.indexOf("}, [load]);", feed.indexOf("const reshuffle = useCallback")));
    expect(fn).toContain("writeResume(null);");
    expect(fn).toContain("seedRef.current = newSeed();");
    expect(fn).toContain("await load(null);");
  });

  it("a first page asks for the visit's order: its seed and the last visit; a later page only its cursor", () => {
    expect(feed).toContain("`?seed=${encodeURIComponent(seedRef.current ?? \"\")}&since=${previousVisit() ?? \"\"}`");
    expect(feed).toContain("if (!cursor && page.seed) seedRef.current = page.seed;");
  });

  it("a return within the session resumes the same order and place; a new session is a fresh shuffle", () => {
    expect(feed).toContain("sessionStorage.getItem(RESUME_KEY)");
    expect(feed).toMatch(/const resume = readResume\(\);\s*if \(resume\) \{/);
    expect(feed).toContain("seedRef.current = resume.seed;");
    expect(feed).toContain("window.scrollTo(0, resume.y)");
    // teeth: localStorage would survive a relaunch and pin the same opener forever
    expect(feed).not.toContain("localStorage.getItem(RESUME_KEY)");
  });

  it("the last visit is read once and mirrored in the cookie the server-rendered page reads", () => {
    expect(feed).toContain("document.cookie = `${EXCLUSIVE_SEEN_COOKIE}=${now}; Path=/; Max-Age=31536000; SameSite=Lax`;");
    expect(code("app/(app)/exclusive/page.tsx")).toContain('(await cookies()).get("frenz_ex_seen")');
    expect(feed).toContain('export const EXCLUSIVE_SEEN_COOKIE = "frenz_ex_seen";');
    // the subscriptions row uses the same reading (two readers would each overwrite the other's visit)
    expect(feed).toContain("useEffect(() => setSince(previousVisit() ?? 0), []);");
  });
});
