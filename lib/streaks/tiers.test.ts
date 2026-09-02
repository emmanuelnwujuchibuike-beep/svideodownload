import { describe, expect, it } from "vitest";

import {
  STREAK_BADGE_MIN_DAYS,
  STREAK_TIERS,
  crossedTier,
  milestoneFor,
  nextTier,
  previousTier,
  tierFor,
} from "./tiers";

/**
 * The tier boundaries, asserted because they are invisible in review and very
 * visible to the person who hit 100 days and got the wrong flame.
 *
 * Owner, 2026-08-30: badge starts at 2 days; the fire changes colour at 7, 14,
 * 30 and 100 days, plus a one-year tier — silver/white since 2026-09-01, when
 * the owner named the flame gallery as the source of truth for the palette.
 */

describe("tierFor", () => {
  it("🔴 SHOWS FROM DAY ONE — a day-1 anonymous visitor is the common case", () => {
    /*
      This threshold was briefly 2, which removed the badge from essentially
      every anonymous landing visitor (they are on day 1) and was reported
      within the hour. The badge appearing on day 1 is what tells a first-time
      visitor a streak exists at all. Raising this again is a regression.
    */
    expect(STREAK_BADGE_MIN_DAYS).toBe(1);
    expect(tierFor(1)?.id).toBe("spark");
    // Zero is genuinely "no streak" and still renders nothing.
    expect(tierFor(0)).toBeNull();
  });

  it("🔴 lands on the right tier at each exact threshold", () => {
    // The off-by-one that would ship silently.
    expect(tierFor(2)?.id).toBe("spark");
    expect(tierFor(7)?.id).toBe("blue");
    expect(tierFor(14)?.id).toBe("green");
    expect(tierFor(30)?.id).toBe("purple");
    expect(tierFor(100)?.id).toBe("gold");
    expect(tierFor(365)?.id).toBe("silver");
  });

  it("holds the tier for the day BEFORE the next one", () => {
    expect(tierFor(6)?.id).toBe("spark");
    expect(tierFor(13)?.id).toBe("blue");
    expect(tierFor(29)?.id).toBe("green");
    expect(tierFor(99)?.id).toBe("purple");
    expect(tierFor(364)?.id).toBe("gold");
    expect(tierFor(10_000)?.id).toBe("silver");
  });

  it("never throws on a broken number", () => {
    expect(tierFor(NaN)).toBeNull();
    expect(tierFor(-5)).toBeNull();
    // Infinity is not a streak anyone has. Refusing it (rather than awarding
    // the top flame) keeps a corrupt cached value from minting a one-year tier.
    expect(tierFor(Infinity)).toBeNull();
  });
});

describe("crossedTier — a milestone is a different event from a day", () => {
  it("fires only when the tier actually changes", () => {
    expect(crossedTier(6, 7)?.id).toBe("blue");
    expect(crossedTier(99, 100)?.id).toBe("gold");
    // An ordinary day inside a tier is not a milestone.
    expect(crossedTier(7, 8)).toBeNull();
    expect(crossedTier(2, 3)).toBeNull();
  });

  it("counts the very first badge as a milestone", () => {
    // 0 -> 1 is the chip APPEARING, which is worth celebrating.
    expect(crossedTier(0, 1)?.id).toBe("spark");
    // 1 -> 2 is an ordinary day inside the spark tier.
    expect(crossedTier(1, 2)).toBeNull();
  });

  it("does not fire on a decrease", () => {
    expect(crossedTier(100, 2)).toBeNull();
    expect(crossedTier(7, 0)).toBeNull();
  });
});

describe("nextTier", () => {
  it("points at the next milestone up, not the top one", () => {
    expect(nextTier(2)).toEqual({ tier: expect.objectContaining({ id: "blue" }), inDays: 5 });
    expect(nextTier(14)).toEqual({ tier: expect.objectContaining({ id: "purple" }), inDays: 16 });
    expect(nextTier(100)).toEqual({ tier: expect.objectContaining({ id: "silver" }), inDays: 265 });
  });

  it("is null at the top", () => {
    expect(nextTier(365)).toBeNull();
    expect(nextTier(9999)).toBeNull();
  });
});

describe("the table itself", () => {
  it("🔴 is ordered longest-first, which tierFor depends on", () => {
    const mins = STREAK_TIERS.map((t) => t.minDays);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
  });

  it("🔴 writes every Tailwind class out in full", () => {
    /*
      Tailwind scans source TEXT. An interpolated class name is never emitted
      into the CSS, and the symptom is an unstyled chip in production while dev
      looks fine — a trap this project has hit before.

      Asserted on the resolved DATA rather than the file's bytes: a source scan
      also matches the sentence explaining the rule, which is how the first
      version of this test failed on its own documentation.
    */
    for (const t of STREAK_TIERS) {
      for (const [field, value] of Object.entries({ text: t.text, ring: t.ring, fill: t.fill, spark: t.spark })) {
        expect(value, `${t.id}.${field} contains an interpolation`).not.toMatch(/\$\{|undefined|NaN/);
        expect(value.trim().length, `${t.id}.${field} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("gives every tier a distinct colour — the colour IS the rank", () => {
    const flames = STREAK_TIERS.map((t) => t.flame.join());
    expect(new Set(flames).size).toBe(STREAK_TIERS.length);
    const sparks = STREAK_TIERS.map((t) => t.spark);
    expect(new Set(sparks).size).toBe(STREAK_TIERS.length);
  });
});

describe("milestoneFor — the 6→7 transition, not 'currently 7'", () => {
  it("🔴 fires on the exact threshold day", () => {
    expect(milestoneFor(7)?.id).toBe("blue");
    expect(milestoneFor(14)?.id).toBe("green");
    expect(milestoneFor(30)?.id).toBe("purple");
    expect(milestoneFor(100)?.id).toBe("gold");
    expect(milestoneFor(365)?.id).toBe("silver");
  });

  it("🔴 does NOT fire on the days either side of a threshold", () => {
    for (const d of [6, 8, 13, 15, 29, 31, 99, 101, 364, 366]) {
      expect(milestoneFor(d)).toBeNull();
    }
  });

  /*
    🔴 REVERSED 2026-09-01. Day 1 used to be excluded ("arriving is not an
    achievement"); the owner now lists it as the first rung — "DAY 1: Small,
    welcoming celebration." Acquiring the orange flame IS a flame upgrade, and
    "only on flame upgrade" is the rule the whole system now runs on.

    The old concern (a takeover on an anonymous visitor's first landing view)
    is answered by `ceremony: 1`, which renders a compact card rather than
    taking the screen — not by refusing the milestone.
  */
  it("🔴 treats day 1 as the first rung, at the lowest ceremony rank", () => {
    expect(milestoneFor(1)?.id).toBe("spark");
    expect(milestoneFor(1)?.ceremony).toBe(1);
  });

  it("🔴 never treats a streak below the badge threshold as a milestone", () => {
    expect(milestoneFor(0)).toBeNull();
    expect(milestoneFor(-1)).toBeNull();
  });

  it("never throws on a broken number", () => {
    expect(milestoneFor(Number.NaN)).toBeNull();
    expect(milestoneFor(Number.POSITIVE_INFINITY)).toBeNull();
    expect(milestoneFor(-7)).toBeNull();
  });

  /*
    The architecture requirement: a new milestone is added by adding a TIER, so
    there can never be a second list to forget to update.
  */
  it("🔴 derives milestones from the tier table, with no separate list", () => {
    for (const t of STREAK_TIERS) {
      if (t.minDays <= STREAK_BADGE_MIN_DAYS) continue;
      expect(milestoneFor(t.minDays)?.id).toBe(t.id);
    }
  });
});

describe("the gallery metadata", () => {
  it("🔴 gives every tier a blurb — an unexplained colour is decoration", () => {
    for (const t of STREAK_TIERS) {
      expect(t.blurb.length).toBeGreaterThan(10);
      expect(t.blurb.trim()).toBe(t.blurb);
    }
  });

  it("🔴 escalates motion with rank, so the flame is not colour alone", () => {
    const byId = Object.fromEntries(STREAK_TIERS.map((t) => [t.id, t.motion]));
    expect(byId.spark).toBe("steady");
    expect(byId.blue).toBe("ascend");
    expect(byId.purple).toBe("smoke");
    expect(byId.gold).toBe("storm");
    expect(byId.silver).toBe("storm");
  });

  it("🔴 gives every tier its own unlock line — no two ranks say the same thing", () => {
    /*
      Owner, 2026-09-01 §4: "Do not make every milestone celebration
      identical." The ceremony reads `unlockLine`, so two tiers sharing one
      would make two ranks literally indistinguishable in the only sentence
      the member reads at the moment it matters.
    */
    const lines = STREAK_TIERS.map((t) => t.unlockLine);
    expect(new Set(lines).size).toBe(STREAK_TIERS.length);
    for (const t of STREAK_TIERS) {
      expect(t.unlockLine.trim(), `${t.id}.unlockLine`).toBe(t.unlockLine);
      expect(t.unlockLine.length, `${t.id}.unlockLine is empty`).toBeGreaterThan(8);
    }
  });

  it("🔴 escalates ceremony intensity strictly with rarity", () => {
    /*
      §4: "The visual intensity should increase with the rarity of the flame."
      The table is longest-first, so ceremony must DESCEND through it — a flat
      or non-monotonic run is how 100 days ends up feeling like 7.
    */
    const levels = STREAK_TIERS.map((t) => t.ceremony);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(new Set(levels).size).toBe(STREAK_TIERS.length);
    // Rank 1 is what keeps Day 1 a card rather than a takeover.
    expect(STREAK_TIERS[STREAK_TIERS.length - 1]!.ceremony).toBe(1);
  });

  it("🔴 says DOWNLOADS, not logins", () => {
    /*
      §2: "Do NOT describe the flames as simply 'login streaks.'" Asserted on
      the resolved data rather than the file's bytes, so the sentence
      explaining the rule cannot fail its own test.
    */
    for (const t of STREAK_TIERS) {
      expect(t.blurb.toLowerCase(), `${t.id}.blurb`).not.toMatch(/log ?in|sign ?in|open the app/);
    }
    const corpus = STREAK_TIERS.map((t) => t.blurb.toLowerCase()).join(" ");
    expect(corpus).toMatch(/download/);
  });
});

describe("previousTier — the flame you are transforming FROM (§3)", () => {
  it("walks one rung down the ladder", () => {
    const byId = Object.fromEntries(STREAK_TIERS.map((t) => [t.id, t]));
    expect(previousTier(byId.silver!)?.id).toBe("gold");
    expect(previousTier(byId.gold!)?.id).toBe("purple");
    expect(previousTier(byId.purple!)?.id).toBe("green");
    expect(previousTier(byId.green!)?.id).toBe("blue");
    expect(previousTier(byId.blue!)?.id).toBe("spark");
  });

  it("🔴 is null at the bottom, which is what makes Day 1 an ignition", () => {
    // There is no flame to transform FROM on day one, and the ceremony relies
    // on this to skip the crossover rather than fading in from nothing.
    const spark = STREAK_TIERS[STREAK_TIERS.length - 1]!;
    expect(spark.id).toBe("spark");
    expect(previousTier(spark)).toBeNull();
  });
});
