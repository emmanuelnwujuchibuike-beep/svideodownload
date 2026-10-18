import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Typing indicator authorization (0259 + 0260, owner 2026-10-18) — the guards that run on every
 * `npm test`. The behaviour itself (blocks both ways, messaging restrictions, groups, removed
 * members, malformed topics, comments, grants, a non-superuser owner, and mutants that must fail)
 * is proven against Postgres by supabase/tests/0259_typing_authorization.pglite.mjs, run by hand.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const m0259 = code("supabase/migrations/0259_typing_topic_allowed.sql");
const m0260 = code("supabase/migrations/0260_typing_presence_policies.sql");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");

const OLD_POLICIES = [
  "typing presence conversation members",
  "typing presence conversation members write",
  "typing presence comment post visible",
  "typing presence comment post visible write",
];

/** Policy names a migration drops / creates on realtime.messages. */
const dropped = (sql: string) => [...noComments(sql).matchAll(/drop policy if exists "([^"]+)" on realtime\.messages/g)].map((m) => m[1] ?? "");
const created = (sql: string) => [...noComments(sql).matchAll(/create policy "([^"]+)" on realtime\.messages/g)].map((m) => m[1] ?? "");

describe("0260 replaces every old typing policy (permissive policies are OR'd)", () => {
  it("drops all four old names and creates only the two new ones", () => {
    for (const name of OLD_POLICIES) expect(dropped(m0260)).toContain(name);
    expect(created(m0260).sort()).toEqual(["typing presence topic allowed", "typing presence topic allowed write"]);
  });
  it("touches no other realtime.messages policy", () => {
    const allowed = new Set([...OLD_POLICIES, "typing presence topic allowed", "typing presence topic allowed write"]);
    for (const name of dropped(m0260)) expect(allowed.has(name), name).toBe(true);
  });
  it("both new policies go through the helper, with no cast of their own", () => {
    const body = noComments(m0260);
    expect(body.match(/public\.typing_topic_allowed\(realtime\.topic\(\)\)/g)?.length).toBe(2);
    expect(body).not.toMatch(/::uuid/);
  });
  it("creates before it drops, so a missing helper leaves the old policies in place", () => {
    const body = noComments(m0260);
    expect(body.indexOf('create policy "typing presence topic allowed write"')).toBeLessThan(body.indexOf('drop policy if exists "typing presence conversation members"'));
  });
  it("teeth: a 0260 that forgot one old policy is caught", () => {
    const forgot = m0260.replace('drop policy if exists "typing presence comment post visible write" on realtime.messages;', "");
    expect(OLD_POLICIES.every((n) => dropped(forgot).includes(n))).toBe(false);
  });
});

describe("0259 survives the migration runner", () => {
  it("uses plain $$ only — never a named tag the runner has not been seen to keep", () => {
    expect(noComments(m0259)).not.toMatch(/\$[A-Za-z_]+\$/);
    expect(noComments(m0259).split("$$").length - 1).toBe(4); // the function body + the grants block
  });
  it("keeps plain DDL out of the function file and dollar quotes out of the policy file", () => {
    const outside = noComments(m0259).split("$$").filter((_, i) => i % 2 === 0).join("");
    expect(outside.replace(/\s+/g, " ").trim()).toBe(
      "create or replace function public.typing_topic_allowed(p_topic text) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as ; do ;",
    );
    expect(m0260).not.toContain("$$");
  });
  it("checks a segment's uuid shape before every cast, and pins the caller to auth.uid()", () => {
    const body = noComments(m0259);
    expect(body.match(/::uuid/g)?.length).toBe(2);
    expect(body.indexOf("v_parts[3] !~ uuid_re")).toBeLessThan(body.indexOf("v_parts[3]::uuid"));
    expect(body.indexOf("v_parts[2] !~ uuid_re")).toBeLessThan(body.indexOf("v_parts[2]::uuid"));
    expect(body).toContain("v_uid uuid := auth.uid();");
    expect(body).not.toMatch(/typing_topic_allowed\([^)]*uuid/); // no user parameter
  });
  it("is not executable by anon", () => {
    expect(m0259).toContain("revoke all on function public.typing_topic_allowed(text) from public, anon");
    expect(m0259).toContain("grant execute on function public.typing_topic_allowed(text) to authenticated, service_role");
  });
});

describe("the client asks only when allowed (typing-privacy.ts is wired in)", () => {
  it("the open thread's channel follows Ghost Mode and revocation", () => {
    expect(code("features/social/conversation-room.tsx")).toContain("roomTypingTopic(conversationId, viewerTypingIndicatorsEnabled, typingRevoked)");
  });
  it("inbox rows follow the viewer's setting, and revocation reaches them too", () => {
    const list = code("features/social/conversation-list.tsx");
    expect(list).toContain("subscribeTyping={rowSubscribesTyping(i, typingEnabled)}");
    expect(list).toContain("const subscribeTyping = typingAllowed && !typingRevoked;");
    expect(code("features/social/instant-inbox.tsx")).toContain("typingEnabled={inbox.data.typingIndicatorsEnabled}");
  });
  it("revocation is announced only after the server confirms a block or a messaging restriction", () => {
    const sheet = code("features/social/block-options-sheet.tsx");
    expect(sheet).toMatch(/if \(!res\.ok\) throw new Error\(\);\s*if \(next && scope === "messaging"\) onTypingRevoked\?\.\(\);/);
    expect(sheet).toMatch(/if \(next\) \{\s*onTypingRevoked\?\.\(\);/);
    expect(code("features/social/thread-options-sheet.tsx")).toContain("onTypingRevoked={() => announceTypingRevoked(conversationId)}");
  });
  it("comment typing is untouched (messaging Ghost Mode does not govern it)", () => {
    expect(code("features/social/comment-typing-indicator.tsx")).not.toContain("typing-privacy");
  });
});
