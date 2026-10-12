import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { actionsFor } from "@/lib/notifications/actions";
import { cleanLabels, isEmptyQuery, matchesQuery, parseActivityQuery, type Searchable } from "@/lib/notifications/search";

/*
  Feature 20 Parts 3–4 — the Universal Inbox search parser, private labels and the
  Smart Action table. Pure, so pinned here without a database.
*/
const NOW = new Date(2026, 9, 12, 15, 0, 0); // 12 Oct 2026, local time
const item = (p: Partial<Searchable> = {}): Searchable => ({ type: "message", category: "social", createdAt: new Date(2026, 9, 12, 10).toISOString(), read: false, actors: [{ displayName: "Chris Obi", handle: "chris" }], text: "hello there", labels: [], ...p });

describe("plain-language search", () => {
  it("'messages from chris' → messages, from chris — and says so", () => {
    const q = parseActivityQuery("messages from chris", NOW);
    expect(q.types).toContain("message");
    expect(q.from).toBe("chris");
    expect(q.chips).toEqual(["from chris", "Messages"]);
    expect(matchesQuery(item(), q)).toBe(true);
    expect(matchesQuery(item({ actors: [{ displayName: "Ana", handle: "ana" }] }), q)).toBe(false);
    expect(matchesQuery(item({ type: "comment" }), q)).toBe(false);
  });

  it("'security alerts last week' → the security category, the week before this one", () => {
    const q = parseActivityQuery("security alerts last week", NOW);
    expect(q.categories).toEqual(["security"]);
    expect(q.words).toEqual([]);
    expect(matchesQuery(item({ type: "security_login", category: "security", createdAt: new Date(2026, 9, 2).toISOString() }), q)).toBe(true);
    expect(matchesQuery(item({ type: "security_login", category: "security", createdAt: new Date(2026, 9, 11).toISOString() }), q)).toBe(false);
  });

  it("dates: today, yesterday, last N days", () => {
    expect(matchesQuery(item({ createdAt: new Date(2026, 9, 11, 9).toISOString() }), parseActivityQuery("yesterday", NOW))).toBe(true);
    expect(matchesQuery(item({ createdAt: new Date(2026, 9, 12, 9).toISOString() }), parseActivityQuery("yesterday", NOW))).toBe(false);
    expect(matchesQuery(item(), parseActivityQuery("today", NOW))).toBe(true);
    expect(matchesQuery(item({ createdAt: new Date(2026, 9, 1).toISOString() }), parseActivityQuery("last 3 days", NOW))).toBe(false);
  });

  it("states and the member's own labels", () => {
    expect(matchesQuery(item({ read: true }), parseActivityQuery("unread", NOW))).toBe(false);
    const q = parseActivityQuery("urgent payments", NOW, ["Urgent"]);
    expect(q.labels).toEqual(["Urgent"]);
    expect(matchesQuery(item({ type: "payment_successful", category: "premium", labels: ["Urgent"] }), q)).toBe(true);
    expect(matchesQuery(item({ type: "payment_successful", category: "premium", labels: [] }), q)).toBe(false);
  });

  it("leftover words search the notification's own text; filler narrows nothing", () => {
    expect(matchesQuery(item(), parseActivityQuery("hello", NOW))).toBe(true);
    expect(matchesQuery(item(), parseActivityQuery("invoice", NOW))).toBe(false);
    expect(isEmptyQuery(parseActivityQuery("show me my notifications", NOW))).toBe(true);
  });

  it("the server builds its filters from the same parser and never puts raw input in a filter (teeth)", () => {
    const src = readFileSync("lib/social/notifications.ts", "utf8");
    expect(src).toMatch(/parseActivityQuery\(search\.slice\(0, 200\)/);
    // every user-typed value is reduced to letters / digits / . _ - before reaching .or()
    expect(src).toMatch(/q\.from\.replace\(\/\[\^\\p\{L\}\\p\{N\}\._-\]\/gu, ""\)/);
    expect(src).toMatch(/raw\.replace\(\/\[\^\\p\{L\}\\p\{N\}\._-\]\/gu, ""\)/);
  });
});

describe("private labels", () => {
  it("trims, de-duplicates case-insensitively, caps at five", () => {
    expect(cleanLabels(["  Urgent ", "urgent", "Clients", "Review later", "Taxes", "Travel", "VIP"])).toEqual(["Urgent", "Clients", "Review later", "Taxes", "Travel"]);
  });
  it("refuses anything that could break out of a filter or a page (teeth)", () => {
    expect(cleanLabels(["a,b", "x}", "<b>", "", "  ", 7, "{urgent}"])).toEqual([]);
    expect(cleanLabels(["x".repeat(25)])).toEqual([]);
  });
});

describe("the Smart Action table", () => {
  it("a chat offers Reply — except a secret chat, which the server can't write for you", () => {
    expect(actionsFor({ type: "message", totalActors: 1, hasActor: true, conversationId: "c" })).toContain("reply");
    expect(actionsFor({ type: "message", totalActors: 1, hasActor: true, conversationId: "c", secretChat: true })).not.toContain("reply");
  });
  it("a person action only on a single-person card", () => {
    expect(actionsFor({ type: "friend_request", totalActors: 1, hasActor: true, conversationId: null })).toEqual(["accept", "decline", "view_profile"]);
    expect(actionsFor({ type: "friend_request", totalActors: 3, hasActor: true, conversationId: null })).toEqual(["open"]);
  });
});
