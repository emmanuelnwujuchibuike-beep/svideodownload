import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const intro = readFileSync("features/ads-platform/guest-ads-intro.tsx", "utf8");
const dash = readFileSync("features/ads-platform/my-campaigns.tsx", "utf8");
const page = readFileSync("app/(marketing)/advertise/campaigns/page.tsx", "utf8");

// Owner, 2026-10-31: the signed-out "Your ads" explains publishing your brand, in floating glass with a glass sign-in;
// static and instant; never touches the landing (they share the marketing stylesheet).
function ok(i: string, d: string, p: string): boolean {
  return (
    /export const dynamic = "force-static";/.test(p) &&
    /if \(!loading && !user\) return <GuestAdsIntro \/>;/.test(d) &&
    /Publish your brand on Frenz/.test(i) &&
    /Sign in to start/.test(i) &&
    // static: no hooks, no fetch
    !/\buse[A-Z]\w*\(|fetch\(/.test(i) &&
    // no blur (heat) and no new stylesheet classes: the glass is inline, on theme tokens
    !/backdropFilter|backdrop-blur/.test(i) &&
    !/className="[^"]*frenz-/.test(i) &&
    /hsl\(var\(--card\)/.test(i)
  );
}

describe("the signed-out Your ads page", () => {
  it("holds", () => {
    expect(ok(intro, dash, page)).toBe(true);
  });
  it("has teeth", () => {
    expect(ok(intro.replace("export function GuestAdsIntro() {", "export function GuestAdsIntro() {\n  useEffect(() => {}, []);"), dash, page)).toBe(false);
    expect(ok(intro.replace('className="px-5 pb-6 pt-6"', 'className="frenz-glass-tile px-5 pb-6 pt-6"'), dash, page)).toBe(false);
    expect(ok(intro, dash, page.replace('"force-static"', '"force-dynamic"'))).toBe(false);
  });
});
