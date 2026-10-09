import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The Messages page refinement (2026-10-09 reference). */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const list = strip(code("features/social/conversation-list.tsx"));
const inbox = strip(code("features/social/inbox.ts"));

function searchOk(src: string): boolean {
  const input = src.match(/aria-label="Search conversations"[\s\S]*?className="([^"]*)"/)?.[1] ?? "";
  return /\bh-\[3\.25rem\]/.test(input) && /\btext-base\b/.test(input) && !/\bglass\b/.test(input) && /deferredQ\.trim\(\)/.test(src);
}

function coalesced(src: string): boolean {
  return (
    /timer = setTimeout\(\(\) => void flush\(\), INBOX_COALESCE_MS\);/.test(src) &&
    /\.on\([\s\S]*?bump,\s*\)/.test(src) &&
    !/const bump = \(\) => void revalidate\(/.test(src) &&
    /if \(timer\) clearTimeout\(timer\);\s*window\.removeEventListener\("online", bump\);/.test(src)
  );
}

describe("Messages: search, tabs and rows", () => {
  it("search is a plain 52px pill, 16px text (no iOS zoom), filtered from a deferred query", () => {
    expect(searchOk(list)).toBe(true);
  });
  it("teeth: the frosted field or a 14px input fails", () => {
    expect(searchOk(list.replace("h-[3.25rem] w-full rounded-full", "glass h-[3.25rem] w-full rounded-full"))).toBe(false);
    expect(searchOk(list.replace("pr-12 text-base", "pr-12 text-sm"))).toBe(false);
  });
  it("tabs scroll sideways instead of squeezing, with 44px targets", () => {
    expect(list).toMatch(/sticky top-0 z-10 mb-1 flex items-center gap-0.5 overflow-x-auto/);
    expect(list).toMatch(/relative flex h-11 shrink-0 items-center gap-1\.5 whitespace-nowrap px-2/);
  });
  it("row avatars are sized and lazy; unread without a count still shows a dot", () => {
    expect((list.match(/width=\{52\} height=\{52\} loading="lazy" decoding="async"/g) ?? []).length).toBe(2);
    expect(list).toMatch(/\) : c\.unread \? \(\s*<span className="mt-1 h-2\.5 w-2\.5 rounded-full bg-blue-600/);
  });
  it("stories render compact on the inbox only", () => {
    expect(code("features/social/inbox-stories-row.tsx")).toContain("viewerHandle={handle} compact />");
    expect(code("app/(app)/home/page.tsx")).not.toMatch(/<StoriesRow[^>]*\bcompact\b/);
  });
});

describe("Messages: realtime refetches are coalesced", () => {
  it("a burst of inbox events becomes one refetch, and the timer is cleared on unmount", () => {
    expect(coalesced(inbox)).toBe(true);
  });
  it("teeth: refetching on every event again fails", () => {
    expect(coalesced(inbox.replace("const bump = () => {", "const bump = () => void revalidate(INBOX_KEY, loadInbox, 0);\n    const _old = () => {"))).toBe(false);
  });
});
