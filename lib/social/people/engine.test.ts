import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { confidenceFor, isEligible, matchesFilter, rankSuggestions, reasonFor, type SuggestionCandidate } from "@/lib/social/graph/suggestions";

import { overlap, rankForViewer } from "./engine";

/* ── a tiny in-memory PostgREST: just the filters the engine uses ─────────── */
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const parseOr = (expr: string) =>
    expr.split(/,(?![^(]*\))/).map((part) => {
      const [col, op, ...rest] = part.split(".");
      const val = rest.join(".");
      return (r: Row) => (op === "eq" ? String(r[col!]) === val : op === "in" ? val.replace(/^\(|\)$/g, "").split(",").includes(String(r[col!])) : false);
    });
  const builder = (rows: Row[]) => {
    let out = [...rows];
    let single = false;
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => ((out = out.filter((r) => r[c] === v)), b),
      neq: (c: string, v: unknown) => ((out = out.filter((r) => r[c] !== v)), b),
      gt: (c: string, v: number) => ((out = out.filter((r) => Number(r[c]) > v)), b),
      in: (c: string, v: unknown[]) => ((out = out.filter((r) => v.includes(r[c]))), b),
      not: (c: string, _op: string, _v: null) => ((out = out.filter((r) => r[c] != null)), b),
      or: (expr: string) => {
        const preds = parseOr(expr);
        out = out.filter((r) => preds.some((p) => p(r)));
        return b;
      },
      order: () => b,
      limit: (n: number) => ((out = out.slice(0, n)), b),
      maybeSingle: () => ((single = true), b),
      then: (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve(res({ data: single ? (out[0] ?? null) : out, error: null })),
    };
    return b;
  };
  return { from: (t: string) => builder(tables[t] ?? []) } as never;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(1);
const profile = (n: number, extra: Row = {}): Row => ({
  id: id(n), handle: `user${n}`, display_name: `User ${n}`, avatar_url: null, is_verified: false, followers_count: 10,
  is_suspended: false, is_hidden: false, visibility: "public", created_at: "2025-01-01T00:00:00Z", location: "", profile_type: "personal", deletion_requested_at: null, ...extra,
});
const fr = (a: number, b: number): Row => ({ user_low: id(Math.min(a, b)), user_high: id(Math.max(a, b)) });
const follow = (a: number, b: number): Row => ({ follower_id: id(a), following_id: id(b) });

function world(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    // me(1) is friends with 2 and 3. 2 is friends with 10 and 11. 3 is friends with 10.
    friendships: [fr(1, 2), fr(1, 3), fr(2, 10), fr(3, 10), fr(2, 11), fr(2, 12)],
    // me follows 4. 4 follows 20. 13 follows me.
    follows: [follow(1, 4), follow(4, 20), follow(13, 1)],
    friend_requests: [] as Row[],
    people_suggestion_feedback: [] as Row[],
    profiles: [profile(1), profile(2), profile(3), profile(4), profile(10), profile(11, { profile_type: "creator", is_verified: true }), profile(12), profile(13), profile(20)],
    privacy_settings: [] as Row[],
    blocks: [] as Row[],
    muted_creators: [] as Row[],
    user_restrictions: [] as Row[],
    circle_members: [] as Row[],
    user_interest_profile: [] as Row[],
    ...overrides,
  };
}

const run = (w: ReturnType<typeof world>, filter: Parameters<typeof rankForViewer>[2] = "all") => rankForViewer(fakeDb(w), ME, filter, 20, null);

describe("People You May Know: the engine over a real-shaped graph", () => {
  it("finds friends of friends, people your follows follow, and people who follow you, each with a true reason", async () => {
    const out = await run(world());
    const by = new Map(out.map((p) => [p.handle, p]));
    expect(by.get("user10")?.reason).toBe("2 friends in common");
    expect(by.get("user11")?.reason).toBe("1 friend in common");
    expect(by.get("user13")?.reason).toBe("Follows you");
    expect(by.get("user20")?.reason).toBe("Followed by someone you follow");
    // two mutual friends rank above one
    expect(out.findIndex((p) => p.handle === "user10")).toBeLessThan(out.findIndex((p) => p.handle === "user11"));
    // never yourself or a friend
    expect(out.some((p) => [ME, id(2), id(3)].includes(p.id))).toBe(false);
  });

  it("a mutual whose friends list is private is counted for ranking but never named or counted out loud", async () => {
    const w = world({ privacy_settings: [{ user_id: id(3), show_in_recommendations: true, followers_visibility: "private" }] });
    const ten = (await run(w)).find((p) => p.handle === "user10")!;
    expect(ten.reason).not.toMatch(/friend/);
    // teeth: the same graph with a public list does say it
    expect((await run(world())).find((p) => p.handle === "user10")!.reason).toBe("2 friends in common");
  });

  it("removes blocks either way, mutes, restrictions, opt-outs, suspended, hidden, private and pending requests", async () => {
    const w = world({
      blocks: [{ blocker_id: id(10), blocked_id: ME }],
      muted_creators: [{ muter_id: ME, muted_id: id(11) }],
      user_restrictions: [{ restrictor_id: ME, restricted_id: id(12) }],
      privacy_settings: [{ user_id: id(13), show_in_recommendations: false, followers_visibility: "public" }],
      friend_requests: [{ sender_id: ME, receiver_id: id(20), status: "pending" }],
    });
    expect((await run(w)).map((p) => p.handle)).toEqual([]);
    const w2 = world({ profiles: world().profiles.map((p) => (p.id === id(10) ? { ...p, is_suspended: true } : p.id === id(11) ? { ...p, visibility: "private" } : p)) });
    const names = (await run(w2)).map((p) => p.handle);
    expect(names).not.toContain("user10");
    expect(names).not.toContain("user11");
  });

  it("feedback: hidden people stay hidden; a snooze that has run out brings them back", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const w = world({
      people_suggestion_feedback: [
        { viewer_id: ME, subject_id: id(10), action: "not_interested", snooze_until: null },
        { viewer_id: ME, subject_id: id(11), action: "later", snooze_until: future },
        { viewer_id: ME, subject_id: id(13), action: "later", snooze_until: past },
      ],
    });
    const names = (await run(w)).map((p) => p.handle);
    expect(names).not.toContain("user10");
    expect(names).not.toContain("user11");
    expect(names).toContain("user13");
  });

  it("filters are facts: creators means profile_type creator, verified means verified", async () => {
    expect((await run(world(), "creators")).map((p) => p.handle)).toEqual(["user11"]);
    expect((await run(world(), "verified")).map((p) => p.handle)).toEqual(["user11"]);
    expect((await run(world(), "mutual")).map((p) => p.handle).sort()).toEqual(["user10", "user11", "user12", "user13"]);
  });

  it("confidence and score stay on the server: the public engine strips them", () => {
    const src = readFileSync(join(process.cwd(), "lib/social/people/engine.ts"), "utf8");
    expect(src).toContain("return ranked.map(({ score: _s, confidence: _c, ...p }) => p);");
    const route = readFileSync(join(process.cwd(), "app/api/people/suggestions/route.ts"), "utf8");
    expect(route).toContain("peopleYouMayKnow(");
    expect(route).not.toContain("rankForViewer");
  });
});

describe("the ranker's Part 6 signals", () => {
  const base: SuggestionCandidate = {
    id: "x", mutualFriends: 0, mutualsDisclosable: false, optedOut: false, isSuspended: false, isHidden: false, blockedEitherWay: false,
    suppressedByViewer: false, alreadyFriend: false, alreadyFollowing: false, requestPending: false, sameLocation: false, sharedCircles: 0, followers: 0, accountAgeDays: 100,
  };
  it("contacts are the most specific reason, and outrank a stranger with followers", () => {
    expect(reasonFor({ ...base, inContacts: true, mutualFriends: 3, mutualsDisclosable: true }).reason).toBe("In your contacts");
    const ranked = rankSuggestions([{ ...base, id: "pop", followers: 1_000_000 }, { ...base, id: "contact", inContacts: true }], { viewerId: "me" });
    expect(ranked[0]!.id).toBe("contact");
  });
  it("mutual follows are named only when every follower's list is public", () => {
    expect(reasonFor({ ...base, mutualFollows: 3, mutualFollowsDisclosable: true }).reason).toBe("Followed by 3 people you follow");
    expect(reasonFor({ ...base, mutualFollows: 3, mutualFollowsDisclosable: false }).reason).toBe("Suggested for you");
  });
  it("interest overlap moves the ranking but is never the reason", () => {
    const r = reasonFor({ ...base, interestOverlap: 1 });
    expect(r.reason).toBe("Suggested for you");
    expect(rankSuggestions([{ ...base, id: "a" }, { ...base, id: "b", interestOverlap: 0.9 }], { viewerId: "me" })[0]!.id).toBe("b");
  });
  it("a dismissed person is not eligible; the profile's own type can be the reason", () => {
    expect(isEligible({ ...base, dismissed: true }, { viewerId: "me" })).toBe(false);
    expect(reasonFor({ ...base, profileType: "business" }).reason).toBe("Business on Frenz");
    expect(matchesFilter({ ...base, profileType: "organization" }, "businesses")).toBe(true);
  });
  it("confidence bands", () => {
    expect([70, 45, 25, 12, 3].map(confidenceFor)).toEqual(["very_high", "high", "medium", "low", "experimental"]);
  });
  it("interest overlap is cosine similarity", () => {
    const a = new Map([["music", 1], ["sports", 1]]);
    expect(overlap(a, new Map([["music", 1], ["sports", 1]]))).toBeCloseTo(1);
    expect(overlap(a, new Map([["cooking", 1]]))).toBe(0);
    expect(overlap(a, undefined)).toBe(0);
  });
});
