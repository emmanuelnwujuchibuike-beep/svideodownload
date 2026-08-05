import { describe, expect, it } from "vitest";

import {
  editDistance,
  findImpersonators,
  lookalikePatterns,
  MATCH_THRESHOLD,
  normalizeName,
  similarity,
  type ImpersonationCandidate,
  type ImpersonationSubject,
} from "@/lib/security/impersonation";

describe("normalizeName", () => {
  it("folds case, accents and separators", () => {
    expect(normalizeName("Émily Wakeforrd")).toBe("emilywakeforrd");
    expect(normalizeName("emily_wakeforrd")).toBe("emilywakeforrd");
    expect(normalizeName("emily.wakeforrd")).toBe("emilywakeforrd");
    expect(normalizeName("Emily-Wakeforrd")).toBe("emilywakeforrd");
  });

  // The substitutions an impersonator actually uses.
  it("folds confusable characters onto the letter they imitate", () => {
    expect(normalizeName("emiIy")).toBe(normalizeName("emily")); // capital i
    expect(normalizeName("emi1y")).toBe(normalizeName("emily")); // digit one
    expect(normalizeName("3mily")).toBe(normalizeName("emily")); // digit three
    expect(normalizeName("emi|y")).toBe(normalizeName("emily")); // pipe
  });

  it("folds Cyrillic lookalikes — the hardest ones to spot", () => {
    // "аmily" with a Cyrillic а.
    expect(normalizeName("аmily")).toBe(normalizeName("amily"));
    expect(normalizeName("оmily")).toBe(normalizeName("omily"));
  });

  it("strips zero-width characters", () => {
    expect(normalizeName("emi\u200bly")).toBe("emily");
    expect(normalizeName("\ufeffemily")).toBe("emily");
  });

  it("survives an empty or punctuation-only name", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName("...")).toBe("");
  });
});

describe("editDistance", () => {
  it("is zero for identical strings", () => {
    expect(editDistance("emily", "emily")).toBe(0);
  });

  it("counts single edits", () => {
    expect(editDistance("emily", "emil")).toBe(1);
    expect(editDistance("emily", "emilyy")).toBe(1);
    expect(editDistance("emily", "amily")).toBe(1);
  });

  it("handles empty inputs", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("", "")).toBe(0);
  });

  it("is symmetric", () => {
    expect(editDistance("kitten", "sitting")).toBe(editDistance("sitting", "kitten"));
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("similarity", () => {
  it("is 1 for names that render the same", () => {
    expect(similarity("Emily", "emily")).toBe(1);
    expect(similarity("emily", "emiIy")).toBe(1);
    expect(similarity("emily_w", "emily.w")).toBe(1);
  });

  it("is low for genuinely different names", () => {
    expect(similarity("emily", "daniel")).toBeLessThan(0.4);
  });

  it("clears the threshold for one appended character", () => {
    expect(similarity("emilywakeforrd", "emilywakeforrd1")).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it("handles empties without dividing by zero", () => {
    expect(similarity("", "")).toBe(1);
    expect(similarity("emily", "")).toBe(0);
  });
});

const subject: ImpersonationSubject = {
  id: "me",
  handle: "emilywakeforrd",
  displayName: "Emily Wakeforrd",
  isVerified: true,
  followersCount: 5000,
};

const candidate = (over: Partial<ImpersonationCandidate> & { id: string }): ImpersonationCandidate => ({
  handle: "someone",
  displayName: "Someone Else",
  avatarUrl: null,
  isVerified: false,
  followersCount: 100,
  accountAgeDays: 400,
  ...over,
});

describe("findImpersonators", () => {
  it("catches a confusable-character clone", () => {
    const matches = findImpersonators(subject, [
      candidate({ id: "fake", handle: "emilywakeforrd", displayName: "Emily Wakeforrd", accountAgeDays: 2, followersCount: 1 }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.exactLookalike).toBe(true);
    expect(matches[0]!.score).toBeGreaterThan(80);
  });

  it("catches an appended-digit handle", () => {
    const matches = findImpersonators(subject, [candidate({ id: "fake", handle: "emilywakeforrd1" })]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.reasons.some((r) => r.includes("username"))).toBe(true);
  });

  it("ignores unrelated accounts entirely", () => {
    expect(findImpersonators(subject, [candidate({ id: "other", handle: "danielokoro", displayName: "Daniel Okoro" })])).toEqual([]);
  });

  it("never returns the subject themselves", () => {
    expect(findImpersonators(subject, [candidate({ id: "me", handle: "emilywakeforrd" })])).toEqual([]);
  });

  // A shared display name is weak evidence — thousands of real people share one.
  it("weights the handle far above the display name", () => {
    const handleClone = findImpersonators(subject, [candidate({ id: "a", handle: "emilywakeforrd", displayName: "Totally Different" })]);
    const nameOnly = findImpersonators(subject, [candidate({ id: "b", handle: "totallydifferent", displayName: "Emily Wakeforrd" })]);
    expect(handleClone[0]!.score).toBeGreaterThan(nameOnly[0]!.score);
  });

  it("discounts a verified account as probably a different real person", () => {
    const unverified = findImpersonators(subject, [candidate({ id: "a", handle: "emilywakeforrd" })]);
    const verified = findImpersonators(subject, [candidate({ id: "b", handle: "emilywakeforrd", isVerified: true })]);
    expect(verified[0]!.score).toBeLessThan(unverified[0]!.score);
    expect(verified[0]!.reasons.some((r) => r.includes("different real person"))).toBe(true);
  });

  it("lifts a brand-new, near-empty lookalike", () => {
    const old = findImpersonators(subject, [candidate({ id: "a", handle: "emilywakeforrd1", accountAgeDays: 900, followersCount: 900 })]);
    const fresh = findImpersonators(subject, [candidate({ id: "b", handle: "emilywakeforrd1", accountAgeDays: 1, followersCount: 0 })]);
    expect(fresh[0]!.score).toBeGreaterThan(old[0]!.score);
  });

  it("ranks the strongest match first and is deterministic on ties", () => {
    const matches = findImpersonators(subject, [
      candidate({ id: "b", handle: "emilywakeforrd_" }),
      candidate({ id: "a", handle: "emilywakeforrd" }),
    ]);
    expect(matches[0]!.candidate.id).toBe("a");
  });

  it("gives every match reasons a person can judge for themselves", () => {
    const matches = findImpersonators(subject, [candidate({ id: "a", handle: "emilywakeforrd" })]);
    for (const r of matches[0]!.reasons) expect(r.length).toBeGreaterThan(15);
  });

  it("returns nothing for an empty candidate set", () => {
    expect(findImpersonators(subject, [])).toEqual([]);
  });
});

describe("lookalikePatterns", () => {
  it("covers the shapes an impersonator actually registers", () => {
    const patterns = lookalikePatterns("emily");
    expect(patterns).toContain("emily");
    expect(patterns).toContain("emily1");
    expect(patterns).toContain("realemily");
    expect(patterns).toContain("emilyofficial");
  });

  it("de-duplicates", () => {
    expect(new Set(lookalikePatterns("emily")).size).toBe(lookalikePatterns("emily").length);
  });

  it("returns nothing for an unusable handle", () => {
    expect(lookalikePatterns("...")).toEqual([]);
    expect(lookalikePatterns("")).toEqual([]);
  });
});
