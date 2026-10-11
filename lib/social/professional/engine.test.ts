import { describe, expect, it } from "vitest";

import {
  careerTimeline,
  dateKey,
  networkSuggestions,
  PRO_ROLE_KEYS,
  PRO_ROLES,
  relationshipHistory,
  ROLE_INVERSES,
  rolePairAllowed,
  trustFactors,
  validateLink,
  validateOpportunity,
  validateRecommendation,
} from "./engine";

describe("professional roles", () => {
  it("every role has at least one inverse, and every inverse is a real role", () => {
    for (const r of PRO_ROLE_KEYS) {
      expect(ROLE_INVERSES[r].length).toBeGreaterThan(0);
      for (const inv of ROLE_INVERSES[r]) expect(PRO_ROLES[inv]).toBeTruthy();
    }
  });

  it("pairs are symmetric: if I can be X to your Y, you can be Y to my X", () => {
    for (const r of PRO_ROLE_KEYS) for (const inv of ROLE_INVERSES[r]) expect(ROLE_INVERSES[inv]).toContain(r);
  });

  it("refuses a pair that makes no sense, and unknown roles", () => {
    expect(rolePairAllowed("manager", "report")).toBe(true);
    expect(rolePairAllowed("manager", "investor")).toBe(false);
    expect(rolePairAllowed("boss", "report")).toBe(false);
  });
});

describe("validation", () => {
  it("a recommendation is plain words of a real length, with at most one link", () => {
    expect(validateRecommendation("Too short").ok).toBe(false);
    expect(validateRecommendation("x".repeat(1501)).ok).toBe(false);
    expect(validateRecommendation("Ada led our launch <script>alert(1)</script> brilliantly").ok).toBe(false);
    expect(validateRecommendation("Great work, see https://a.example and https://b.example too").ok).toBe(false);
    expect(validateRecommendation("  Ada led our launch and   the team loved working with her.  ")).toEqual({ ok: true, value: "Ada led our launch and the team loved working with her." });
  });

  it("only https links leave from an opportunity", () => {
    expect(validateLink("http://jobs.example").ok).toBe(false);
    expect(validateLink("javascript:alert(1)").ok).toBe(false);
    expect(validateLink("https://jobs.example/apply")).toEqual({ ok: true, value: "https://jobs.example/apply" });
    expect(validateLink("")).toEqual({ ok: true, value: null });
  });

  it("an opportunity needs a known kind and a real title", () => {
    expect(validateOpportunity({ kind: "gig", title: "Designer" }).ok).toBe(false);
    expect(validateOpportunity({ kind: "job", title: "UX" }).ok).toBe(false);
    expect(validateOpportunity({ kind: "job", title: "Product designer", remote: true }).ok).toBe(true);
  });
});

describe("Career Timeline", () => {
  it("reads free-text dates without ever throwing", () => {
    expect(dateKey("Mar 2019")).toBe(2019 * 12 + 2);
    expect(dateKey("2021")).toBe(2021 * 12);
    expect(dateKey("2020-07-01")).toBe(2020 * 12 + 6);
    expect(dateKey("a while ago")).toBeNull();
    expect(dateKey(null)).toBeNull();
  });

  it("puts current roles first, then the most recent, and includes confirmed connections", () => {
    const items = careerTimeline({
      credentials: [
        { id: "a", kind: "experience", title: "Designer", organization: "Acme", startedOn: "2018", endedOn: "2020", isCurrent: false },
        { id: "b", kind: "experience", title: "Lead", organization: "Beta", startedOn: "2021", endedOn: null, isCurrent: true },
        { id: "c", kind: "certification", title: "AWS", organization: null, startedOn: "2022", endedOn: null, isCurrent: false },
        { id: "d", kind: "unknown", title: "x", organization: null, startedOn: null, endedOn: null, isCurrent: false },
      ],
      connections: [{ id: "k", name: "Ada", theirRole: "mentor", customLabel: null, context: "at Acme", at: "2019-05-01T00:00:00Z" }],
      recommendations: [],
      now: new Date("2026-10-12T00:00:00Z"),
    });
    expect(items.map((i) => i.key)).toEqual(["cred-b", "cred-c", "cred-a", "conn-k"]);
    expect(items.at(-1)).toMatchObject({ title: "Connected with Ada", sub: "Mentor, at Acme" });
  });
});

describe("Professional Reputation is a checklist, never a score", () => {
  it("names how to meet every factor, and contains no number for others to compare", () => {
    const f = trustFactors({ verified: false, hasHeadline: true, skills: 3, credentials: 1, connections: 2, recommendations: 0, endorsers: 0, accountDays: 400 });
    expect(f.find((x) => x.key === "profile")!.met).toBe(true);
    expect(f.find((x) => x.key === "connections")!.met).toBe(false);
    for (const x of f) expect(x.how.length).toBeGreaterThan(5);
    expect(Object.keys(f[0]!)).not.toContain("score");
  });
});

describe("the Network Assistant explains every suggestion", () => {
  const me = { openTo: ["hiring"], skills: ["Figma", "React"], organizations: ["Acme"], connections: new Set(["k1"]) };
  const names = (id: string) => ({ k1: "Kemi" })[id] ?? id;

  it("gives reasons from shared organizations, mutual colleagues and open-to", () => {
    const out = networkSuggestions(
      me,
      [
        { id: "a", openTo: ["work"], skills: ["react"], organizations: ["ACME"], connectedTo: ["k1"] },
        { id: "b", openTo: [], skills: [], organizations: [], connectedTo: [] },
      ],
      new Set(),
      names,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.reasons).toEqual(["You were both at ACME", "Worked with Kemi", "Available for work, with react"]);
  });

  it("never suggests someone excluded (connected, asked, blocked, dismissed)", () => {
    const out = networkSuggestions(me, [{ id: "a", openTo: ["work"], skills: ["react"], organizations: ["Acme"], connectedTo: [] }], new Set(["a"]), names);
    expect(out).toEqual([]);
  });
});

describe("relationship history", () => {
  it("is in time order and says who gave what", () => {
    const h = relationshipHistory({ requestedAt: "2026-01-01", acceptedAt: "2026-01-02", recommendations: [{ at: "2026-03-01", fromMe: false, kind: "recommendation" }], endorsements: [{ at: "2026-02-01", fromMe: true, skill: "Figma" }] });
    expect(h.map((e) => e.label)).toEqual(["Connection requested", "Connected", "Figma endorsed by you", "Recommendation received"]);
  });
});
