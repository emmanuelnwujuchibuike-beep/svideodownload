import { describe, expect, it } from "vitest";

import { evolutionFor, reconnectReason, relationshipStage, STAGE_COPY, upcomingAnniversaries, type StageInput } from "./stage";

const base: StageInput = { daysKnown: 400, daysSinceMessage: 5, msgs90: 4, msgsPrev90: 4, archived: false };
const NOW = new Date("2026-10-10T12:00:00Z");

describe("Relationship Strength as words (Part 8)", () => {
  it("never a number: no stage copy contains a digit or a percent", () => {
    for (const { label, line } of Object.values(STAGE_COPY)) expect(`${label} ${line}`).not.toMatch(/[0-9%]/);
  });

  it("classifies by time together and your own chat, in a fixed order", () => {
    expect(relationshipStage({ ...base, archived: true })).toBe("archived");
    expect(relationshipStage({ ...base, daysKnown: 20, daysSinceMessage: null })).toBe("new");
    expect(relationshipStage({ ...base, msgs90: 30, msgsPrev90: 10 })).toBe("growing");
    expect(relationshipStage({ ...base, daysKnown: 2000 })).toBe("legacy");
    expect(relationshipStage({ ...base, daysKnown: 800 })).toBe("long_term");
    expect(relationshipStage(base)).toBe("established");
    expect(relationshipStage({ ...base, daysKnown: 150 })).toBe("consistent");
  });

  it("silence is not decay: nothing is inactive before half a year without a word", () => {
    expect(relationshipStage({ ...base, daysKnown: 100, daysSinceMessage: null })).toBe("consistent");
    expect(relationshipStage({ ...base, daysKnown: 200, daysSinceMessage: null })).toBe("inactive");
    expect(relationshipStage({ ...base, daysSinceMessage: 170 })).toBe("established");
    expect(relationshipStage({ ...base, daysSinceMessage: 200 })).toBe("inactive");
  });
});

describe("AI Reconnect", () => {
  const r = (o: Partial<Parameters<typeof reconnectReason>[0]>) => reconnectReason({ daysSinceMessage: 200, archived: false, reconnectOff: false, snoozedUntil: null, now: NOW, ...o });
  it("only after a real silence with someone you have talked to, in words", () => {
    expect(r({ daysSinceMessage: 30 })).toBeNull();
    expect(r({ daysSinceMessage: null })).toBeNull();
    expect(r({ daysSinceMessage: 120 })).toBe("You haven’t spoken in a few months.");
    expect(r({})).toBe("You haven’t spoken in several months.");
    expect(r({ daysSinceMessage: 500 })).toMatch(/over a year/);
  });
  it("always dismissible: archived, switched off, or snoozed means silent", () => {
    expect(r({ archived: true })).toBeNull();
    expect(r({ reconnectOff: true })).toBeNull();
    expect(r({ snoozedUntil: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(r({ snoozedUntil: "2026-10-01T00:00:00Z" })).not.toBeNull();
  });
});

describe("Relationship Evolution and the Memory Surface", () => {
  const ev = (o: Partial<Parameters<typeof evolutionFor>[0]>) => evolutionFor({ isFriend: false, youFollow: true, theyFollow: true, requestPending: false, profileType: "personal", hasLabel: false, ...o });
  it("suggests only what the platform can see for certain", () => {
    expect(ev({})?.kind).toBe("follow_to_friend");
    expect(ev({ requestPending: true })).toBeNull();
    expect(ev({ theyFollow: false })).toBeNull();
    expect(ev({ isFriend: true, profileType: "business" })?.kind).toBe("friend_to_business");
    expect(ev({ isFriend: true, profileType: "business", hasLabel: true })).toBeNull();
  });
  it("anniversaries in the coming week, month ends clamped", () => {
    const m = upcomingAnniversaries(
      [
        { id: "a", name: "Ada", since: "2025-10-12T09:00:00Z" },
        { id: "b", name: "Ben", since: "2026-09-12T09:00:00Z" },
        { id: "c", name: "Cy", since: "2026-03-31T09:00:00Z" },
      ],
      NOW,
    );
    expect(m.map((x) => x.title)).toEqual(["1 month of friendship with Ben", "1 year of friendship with Ada"]);
  });
});
