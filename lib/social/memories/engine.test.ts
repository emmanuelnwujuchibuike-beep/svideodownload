import { describe, expect, it } from "vitest";

import { canViewMemory, findDuplicates, importantMoments, matchesQuery, memoryInsights, onThisDay, parseMemoryQuery, suggestCategory, suggestCollections, validateMemory, type MemoryLite } from "./engine";

const SARAH = { id: "u-sarah", name: "Sarah Ade", handle: "sarah" };
const TOBI = { id: "u-tobi", name: "Tobi", handle: "tobi_k" };
const mem = (o: Partial<MemoryLite> & { id: string }): MemoryLite => ({ title: "Memory", note: null, category: "friendship", occurredOn: "2026-06-12", place: null, sourceKind: "manual", sourceRef: null, pinned: false, people: [], mediaUrls: [], ...o });

const LIB: MemoryLite[] = [
  mem({ id: "beach", title: "The beach trip", note: "Tarkwa bay with everyone", category: "travel", occurredOn: "2025-07-04", people: [SARAH, TOBI] }),
  mem({ id: "project", title: "Shipped the landing page", category: "projects", occurredOn: "2026-02-10", people: [SARAH] }),
  mem({ id: "hello", title: "First chat with Tobi", category: "friendship", sourceKind: "first_message", occurredOn: "2024-10-11", people: [TOBI] }),
  mem({ id: "course", title: "Finished the AI course", category: "education", occurredOn: "2026-03-01" }),
  mem({ id: "meetup", title: "Photography meetup", category: "photography", occurredOn: "2026-03-20", people: [SARAH], mediaUrls: ["https://cdn.x/a.jpg"] }),
];

describe("natural-language memory search (the brief's examples)", () => {
  const find = (q: string) => LIB.filter((m) => matchesQuery(m, parseMemoryQuery(q, [SARAH, TOBI]))).map((m) => m.id);
  it("finds each example and nothing else", () => {
    expect(find("The beach trip.")).toEqual(["beach"]);
    expect(find("The project with Sarah.")).toEqual(["project"]);
    expect(find("Our first conversation.")).toEqual(["hello"]);
    expect(find("The AI course.")).toEqual(["course"]);
    expect(find("The photography meetup.")).toEqual(["meetup"]);
  });
  it("understands a person by handle and a year, and refuses a non-match", () => {
    expect(find("@tobi_k 2025")).toEqual(["beach"]);
    expect(find("the project with Tobi")).toEqual([]);
    expect(parseMemoryQuery("the project with Sarah", [SARAH]).personIds).toEqual(["u-sarah"]);
  });
});

describe("organization", () => {
  it("suggests a category with the word that suggested it", () => {
    expect(suggestCategory("Weekend hike up the mountain")).toEqual({ category: "nature", because: "hike" });
    expect(suggestCategory("just a thought")).toBeNull();
  });
  it("suggests collections only for groups of three or more", () => {
    const keys = suggestCollections(LIB).map((c) => c.key);
    expect(keys).toContain("person:u-sarah");
    expect(keys).not.toContain("person:u-tobi"); // only two
    expect(suggestCollections(LIB, new Set(["person:u-sarah"])).map((c) => c.key)).not.toContain("person:u-sarah");
  });
  it("finds duplicates by media or by title on the same day", () => {
    const d = findDuplicates([...LIB, mem({ id: "dup", title: "Another", mediaUrls: ["https://cdn.x/a.jpg"] }), mem({ id: "dup2", title: "the beach trip", occurredOn: "2025-07-04" })]);
    expect(d).toContainEqual({ a: "meetup", b: "dup", why: "Same photo or video" });
    expect(d).toContainEqual({ a: "beach", b: "dup2", why: "Same title on the same day" });
    expect(findDuplicates(LIB)).toEqual([]);
  });
  it("important moments carry their reasons", () => {
    const top = importantMoments(LIB);
    expect(top.map((t) => t.id)).toContain("hello");
    expect(top.find((t) => t.id === "hello")?.reasons).toContain("A first");
    expect(top.map((t) => t.id)).not.toContain("course");
  });
  it("on this day: earlier years only", () => {
    expect(onThisDay(LIB, new Date("2026-10-11T09:00:00Z"))).toEqual([{ id: "hello", yearsAgo: 2 }]);
    expect(onThisDay(LIB, new Date("2024-10-11T09:00:00Z"))).toEqual([]);
  });
  it("insights are private counts, never invented", () => {
    const i = memoryInsights(LIB);
    expect(i.total).toBe(5);
    expect(i.topPerson).toEqual({ id: "u-sarah", name: "Sarah Ade", count: 3 });
    expect(memoryInsights([]).topPerson).toBeNull();
  });
});

describe("privacy and validation", () => {
  const m = { ownerId: "o", visibility: "private" as const, circleId: null, deleted: false };
  const v = (o: Partial<Parameters<typeof canViewMemory>[1]>) => ({ id: "x", isFriend: false, inPeople: false, circleIds: new Set<string>(), blocked: false, ...o });
  it("private by default; each audience exactly as named", () => {
    expect(canViewMemory(m, v({ isFriend: true, inPeople: true }))).toBe(false);
    expect(canViewMemory(m, v({ id: "o" }))).toBe(true);
    expect(canViewMemory({ ...m, visibility: "people" }, v({ isFriend: true }))).toBe(false);
    expect(canViewMemory({ ...m, visibility: "people" }, v({ inPeople: true }))).toBe(true);
    expect(canViewMemory({ ...m, visibility: "friends" }, v({ isFriend: true }))).toBe(true);
    expect(canViewMemory({ ...m, visibility: "circle", circleId: "c1" }, v({ circleIds: new Set(["c1"]) }))).toBe(true);
    expect(canViewMemory({ ...m, visibility: "circle", circleId: "c1" }, v({ circleIds: new Set(["c2"]) }))).toBe(false);
    expect(canViewMemory({ ...m, visibility: "friends" }, v({ isFriend: true, blocked: true }))).toBe(false);
    expect(canViewMemory({ ...m, visibility: "friends", deleted: true }, v({ id: "o" }))).toBe(false);
    expect(canViewMemory(m, v({ id: null }))).toBe(false);
  });
  it("validation refuses markup, bad links and a circle without a circle", () => {
    expect(validateMemory({ title: "Good" }).ok).toBe(true);
    expect(validateMemory({ title: "" }).ok).toBe(false);
    expect(validateMemory({ title: "<b>x</b>" }).ok).toBe(false);
    expect(validateMemory({ title: "x", linkUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateMemory({ title: "x", visibility: "circle" }).ok).toBe(false);
    expect(validateMemory({ title: "x", occurredOn: "2026-13-40" }).ok).toBe(false);
  });
});
