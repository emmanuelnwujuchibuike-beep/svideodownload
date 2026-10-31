import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { requestFeedTab, takeRequestedFeedTab } from "./feed-topbar-tabs";

/*
  Owner, 2026-10-31: "navigation with the top nav in feed page reload on going back, from exclusive page to for you and
  following and the top nav structure changes when I enter the exclusive feed page … the top nav in feed page is
  supposed to navigate like the bottom NAV". The Exclusive page had its own copy of the row (laid out differently) and
  went to /home?tab=… — a different address from the bottom nav's /home, so a fresh server load every time.
*/
const tabs = readFileSync("features/feed/feed-topbar-tabs.tsx", "utf8");
const feed = readFileSync("features/feed/smart-feed.tsx", "utf8");

const oneRow = (src: string) => {
  const exclusive = src.slice(src.indexOf("export function FeedTabLinks"));
  return (
    /<FeedTabRow active="exclusive" \/>/.test(exclusive) &&
    !/<nav\b/.test(exclusive) && // no second, differently laid-out row
    !/\/home\?tab=/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")) && // never the uncached address (comments aside)
    /href="\/home"/.test(src)
  );
};

describe("one Feed tab row, navigating like the bottom nav", () => {
  it("the Exclusive page renders the Feed's own row, and goes to plain /home", () => {
    expect(oneRow(tabs)).toBe(true);
  });
  it("teeth: a separate copy, or the ?tab= address, fails", () => {
    expect(oneRow(tabs.replace('<FeedTabRow active="exclusive" />', '<nav className="flex gap-[22px]" />'))).toBe(false);
    expect(oneRow(tabs.replace('href="/home"', 'href="/home?tab=for_you"'))).toBe(false);
  });
  it("the wanted tab is handed over in memory, once", () => {
    expect(takeRequestedFeedTab()).toBeNull();
    requestFeedTab("following");
    expect(takeRequestedFeedTab()).toBe("following");
    expect(takeRequestedFeedTab()).toBeNull();
    // and the Feed takes it on mount
    expect(feed).toMatch(/const requested = takeRequestedFeedTab\(\);/);
  });
});
