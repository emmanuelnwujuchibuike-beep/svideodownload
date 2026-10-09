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

function patchesOnly(src: string): boolean {
  return (
    /\.on\([\s\S]*?onChange,\s*\)/.test(src) &&
    /const id = payload\?\.new\?\.conversation_id \?\? payload\?\.old\?\.conversation_id;/.test(src) &&
    /const patched = full \? false : await patchInbox\(ids\);/.test(src) &&
    /fetch\(`\/api\/messages\?ids=\$\{ids\.map\(encodeURIComponent\)\.join\(","\)\}`\)/.test(src) &&
    /timer = setTimeout\(\(\) => void flush\(\), INBOX_COALESCE_MS\);/.test(src) &&
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
    // 2026-10-09: StableAvatar (never reloads on back-swipe) carries the size and lazy loading; it decodes async until seen
    expect((list.match(/<StableAvatar width=\{52\} height=\{52\} loading="lazy"/g) ?? []).length).toBe(2);
    expect(list).toMatch(/\) : c\.unread \? \(\s*<span className="mt-1 h-2\.5 w-2\.5 rounded-full bg-blue-600/);
  });
  it("stories sit 12px above the search pill — not flush, not a gap (owner, 2026-10-09)", () => {
    expect(code("features/social/inbox-stories-row.tsx")).toContain('<section aria-label="Stories" className="pb-2">');
  });
  it("stories render compact on the inbox only", () => {
    expect(code("features/social/inbox-stories-row.tsx")).toContain("viewerHandle={handle} compact />");
    expect(code("app/(app)/home/page.tsx")).not.toMatch(/<StoriesRow[^>]*\bcompact\b/);
  });
});

describe("Messages: a new message patches its own row, not the whole inbox", () => {
  it("events collect conversation ids and one request rebuilds only those", () => {
    expect(patchesOnly(inbox)).toBe(true);
  });
  it("teeth: wiring the event straight to a full reload again fails", () => {
    expect(patchesOnly(inbox.replace("onChange,\n", "bump,\n"))).toBe(false);
    expect(patchesOnly(inbox.replace("const patched = full ? false : await patchInbox(ids);", "const patched = false;"))).toBe(false);
  });
  it("the server rebuilds only the asked-for ids, scoped to the viewer's memberships", () => {
    const api = code("app/api/messages/route.ts");
    expect(api).toContain("listConversations(user.id, { onlyIds: ids })");
    expect(api).toMatch(/UUID_RE\.test\(id\)/);
    const lib = code("lib/social/messages.ts");
    expect(lib).toMatch(/\.eq\("user_id", userId\)\s*\.is\("left_at", null\);\s*if \(opts\.onlyIds\) membershipQuery = membershipQuery\.in\("conversation_id", opts\.onlyIds\);/);
  });
  it("mergeInboxRows replaces, drops and re-sorts exactly the touched rows", async () => {
    const { mergeInboxRows } = await import("@/features/social/inbox");
    const row = (id: string, lastAt: string, extra: Record<string, unknown> = {}) =>
      ({ id, lastAt, pinned: false, unread: false, ...extra }) as never;
    const prev = { conversations: [row("a", "2026-10-09T10:00:00Z"), row("b", "2026-10-09T09:00:00Z"), row("p", "2026-10-01T00:00:00Z", { pinned: true }), row("gone", "2026-10-08T00:00:00Z")], unread: 0 };
    const out = mergeInboxRows(prev, ["b", "gone", "new"], [row("b", "2026-10-09T11:00:00Z", { unread: true }), row("new", "2026-10-09T10:30:00Z", { unread: true })]);
    expect(out.conversations.map((c: { id: string }) => c.id)).toEqual(["p", "b", "new", "a"]);
    expect(out.unread).toBe(2);
    // an untouched row is the same object — nothing else was rebuilt
    expect(out.conversations.find((c: { id: string }) => c.id === "a")).toBe(prev.conversations[0]);
  });
});
