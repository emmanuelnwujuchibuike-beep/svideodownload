import { describe, expect, it } from "vitest";

import {
  canNest,
  csvCell,
  exportCsv,
  inSmartList,
  listInsights,
  listTree,
  organizationSuggestions,
  parseHandles,
  ruleCandidates,
  searchPeople,
  tagCounts,
  validateTag,
  type DirectoryPerson,
  type ListNode,
} from "./engine";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const person = (p: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  id: `u${++n}`,
  handle: `user${n}`,
  displayName: `User ${n}`,
  avatarUrl: null,
  verified: false,
  profileType: "personal",
  friend: true,
  following: false,
  follower: false,
  favorite: false,
  archived: false,
  since: new Date(NOW - 400 * DAY).toISOString(),
  label: null,
  tags: [],
  listIds: [],
  recentMessages: null,
  ...p,
});
const list = (p: Partial<ListNode> & { id: string }): ListNode => ({ name: p.id, color: "blue", icon: "circle", kind: "custom", memberCount: 0, parentId: null, archived: false, description: null, createdAt: new Date(NOW - 100 * DAY).toISOString(), ...p });

describe("smart lists are filters over the graph", () => {
  it("new friends are the last month only, and archived friendships drop out of Friends", () => {
    expect(inSmartList("new_friends", person({ since: new Date(NOW - 5 * DAY).toISOString() }), NOW)).toBe(true);
    expect(inSmartList("new_friends", person({ since: new Date(NOW - 45 * DAY).toISOString() }), NOW)).toBe(false);
    expect(inSmartList("friends", person({ archived: true }), NOW)).toBe(false);
    expect(inSmartList("archived", person({ archived: true }), NOW)).toBe(true);
  });

  it("follow each other means both directions and not yet friends", () => {
    expect(inSmartList("mutual", person({ friend: false, following: true, follower: true }), NOW)).toBe(true);
    expect(inSmartList("mutual", person({ friend: true, following: true, follower: true }), NOW)).toBe(false);
    expect(inSmartList("mutual", person({ friend: false, following: true }), NOW)).toBe(false);
  });

  it("online needs the live set, and a business includes professional profiles", () => {
    const p = person();
    expect(inSmartList("online", p, NOW)).toBe(false);
    expect(inSmartList("online", p, NOW, new Set([p.id]))).toBe(true);
    expect(inSmartList("businesses", person({ profileType: "professional" }), NOW)).toBe(true);
  });
});

describe("list automation", () => {
  it("offers only matching people who are not in the list yet, and never an archived friendship", () => {
    const a = person({ profileType: "creator" });
    const b = person({ profileType: "creator", listIds: ["L"] });
    const c = person({ profileType: "creator", archived: true });
    const d = person();
    const out = ruleCandidates([{ id: "r", circleId: "L", rule: "creator", value: null }], [a, b, c, d], NOW);
    expect(out.get("L")).toEqual([a.id]);
  });

  it("a tag rule matches the tag case-insensitively, and a rule with no match offers nothing", () => {
    const a = person({ tags: ["Investor"] });
    expect(ruleCandidates([{ id: "r", circleId: "L", rule: "tag", value: "investor" }], [a], NOW).get("L")).toEqual([a.id]);
    expect(ruleCandidates([{ id: "r", circleId: "L", rule: "verified", value: null }], [a], NOW).size).toBe(0);
  });
});

describe("nested lists", () => {
  const lists = [list({ id: "biz" }), list({ id: "clients", parentId: "biz" }), list({ id: "premium", parentId: "clients" }), list({ id: "solo" })];

  it("puts children under their parent with a depth", () => {
    expect(listTree(lists).map((x) => `${x.list.id}:${x.depth}`)).toEqual(["biz:0", "clients:1", "premium:2", "solo:0"]);
  });

  it("refuses a cycle, a self-parent, and a fifth level, and allows the fourth", () => {
    expect(canNest(lists, "biz", "premium").ok).toBe(false);
    expect(canNest(lists, "biz", "biz").ok).toBe(false);
    expect(canNest(lists, "solo", "premium").ok).toBe(true); // level 4
    const deeper = [...lists, list({ id: "enterprise", parentId: "premium" })];
    expect(canNest(deeper, "solo", "enterprise").ok).toBe(false); // level 5
    // moving a list WITH children counts their levels too
    expect(canNest(lists, "clients", "solo").ok).toBe(true); // solo > clients > premium = 3
    const deep = [...lists, list({ id: "x" }), list({ id: "y", parentId: "x" }), list({ id: "z", parentId: "y" })];
    expect(canNest(deep, "x", "premium").ok).toBe(false); // 3 + 3 levels
  });

  it("shows bad data (a cycle) instead of hiding the lists", () => {
    const bad = [list({ id: "a", parentId: "b" }), list({ id: "b", parentId: "a" })];
    expect(listTree(bad).map((x) => x.list.id).sort()).toEqual(["a", "b"]);
  });
});

describe("the organization engine suggests, never applies", () => {
  it("offers to merge two lists with nearly the same people, smaller into larger", () => {
    const shared = Array.from({ length: 5 }, () => person({ listIds: ["A", "B"] }));
    const extra = person({ listIds: ["B"] });
    const out = organizationSuggestions({ lists: [list({ id: "A", memberCount: 5 }), list({ id: "B", memberCount: 6 })], people: [...shared, extra], rules: [], now: NOW });
    expect(out.find((s) => s.kind === "merge")).toMatchObject({ from: "A", into: "B" });
  });

  it("does not merge lists that merely overlap, or the special ones", () => {
    const half = Array.from({ length: 4 }, (_, i) => person({ listIds: i < 2 ? ["A", "B"] : ["A"] }));
    expect(organizationSuggestions({ lists: [list({ id: "A" }), list({ id: "B" })], people: half, rules: [], now: NOW }).some((s) => s.kind === "merge")).toBe(false);
    const same = Array.from({ length: 4 }, () => person({ listIds: ["A", "B"] }));
    expect(organizationSuggestions({ lists: [list({ id: "A", kind: "close_friends" }), list({ id: "B" })], people: same, rules: [], now: NOW }).some((s) => s.kind === "merge")).toBe(false);
  });

  it("offers to archive a list that has been empty for a month, not a new one", () => {
    const out = organizationSuggestions({ lists: [list({ id: "old" }), list({ id: "new", createdAt: new Date(NOW - 2 * DAY).toISOString() })], people: [], rules: [], now: NOW });
    expect(out.filter((s) => s.kind === "archive_empty").map((s) => (s as { listId: string }).listId)).toEqual(["old"]);
  });

  it("counts friends in no list, and offers at most five things", () => {
    const people = Array.from({ length: 12 }, () => person());
    const lists = Array.from({ length: 8 }, (_, i) => list({ id: `e${i}` }));
    const out = organizationSuggestions({ lists, people, rules: [], now: NOW });
    expect(out.length).toBeLessThanOrEqual(5);
    expect(organizationSuggestions({ lists: [list({ id: "a", memberCount: 1 })], people, rules: [], now: NOW }).find((s) => s.kind === "sort_unsorted")).toMatchObject({ count: 12 });
  });
});

describe("insights are plain sentences about the member's own lists", () => {
  it("names the largest, the quiet one and the growing one", () => {
    const L = [list({ id: "fam", name: "Family", memberCount: 3 }), list({ id: "work", name: "Work", memberCount: 4 })];
    const people = [
      ...Array.from({ length: 3 }, () => person({ listIds: ["fam"], recentMessages: 0 })),
      ...Array.from({ length: 4 }, () => person({ listIds: ["work"], recentMessages: 2 })),
    ];
    const added = new Map([["work", [new Date(NOW - DAY).toISOString(), new Date(NOW - 2 * DAY).toISOString()]]]);
    const out = listInsights(L, people, added, NOW);
    expect(out.find((i) => i.key === "largest")?.listId).toBe("work");
    expect(out.find((i) => i.key === "quiet")?.listId).toBe("fam");
    expect(out.find((i) => i.key === "growing")?.listId).toBe("work");
    expect(out.find((i) => i.key === "most_active")?.listId).toBe("work");
  });

  it("says nothing about activity when activity is unknown", () => {
    const out = listInsights([list({ id: "a", memberCount: 3 })], [person({ listIds: ["a"] })], new Map(), NOW);
    expect(out.map((i) => i.key)).toEqual(["largest"]);
  });
});

describe("search, tags, import and export", () => {
  it("finds by name, handle, label and tag, ignoring accents and a leading @", () => {
    const a = person({ displayName: "Zoë Adé", handle: "zoe", tags: ["Designer"], label: "mentor" });
    const b = person();
    const f = { smart: null, listId: null, tag: null };
    expect(searchPeople([a, b], { ...f, q: "zoe ade" }, NOW)).toEqual([a]);
    expect(searchPeople([a, b], { ...f, q: "nobody here" }, NOW)).toEqual([]);
    expect(searchPeople([a, b], { ...f, q: "Ade" }, NOW)).toEqual([a]);
    expect(searchPeople([a, b], { ...f, q: "@zoe" }, NOW)).toEqual([a]);
    expect(searchPeople([a, b], { ...f, q: "design" }, NOW)).toEqual([a]);
    expect(searchPeople([a, b], { ...f, q: "", tag: "designer" }, NOW)).toEqual([a]);
  });

  it("tags are plain words up to 24 characters", () => {
    expect(validateTag("  #Investor ")).toEqual({ ok: true, value: "Investor" });
    expect(validateTag("x".repeat(25)).ok).toBe(false);
    expect(validateTag("<b>hi</b>").ok).toBe(false);
    expect(validateTag("https://x.y").ok).toBe(false);
    expect(tagCounts([person({ tags: ["Dev", "VIP"] }), person({ tags: ["dev"] })])[0]).toEqual({ tag: "Dev", count: 2 });
  });

  it("an exported cell can never run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    const csv = exportCsv([person({ handle: "ada", displayName: "+Ada", listIds: ["w"] })], [list({ id: "w", name: "Work" })]);
    expect(csv).toContain(`"'+Ada"`);
    expect(csv).toContain(`"Work"`);
  });

  it("reads handles from pasted lines, CSV columns and profile links, skipping a header", () => {
    expect(parseHandles("handle,name\n@Ada,Ada\nbob\nhttps://frenzsave.com/@cleo\n\n@ada")).toEqual(["ada", "bob", "cleo"]);
  });
});
