import { describe, expect, it } from "vitest";

import { countLevels, visibilityHeadline, visibilitySummary } from "@/lib/privacy/visibility";

describe("visibilitySummary", () => {
  it("covers every audience question a member actually asks", () => {
    const keys = visibilitySummary({}).map((l) => l.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "profile",
        "activity",
        "friends",
        "followers",
        "messages",
        "comments",
        "search",
        "indexing",
        "recommendations",
      ]),
    );
  });

  it("writes full sentences, not column values", () => {
    for (const line of visibilitySummary({})) {
      expect(line.statement.endsWith(".")).toBe(true);
      expect(line.statement).not.toMatch(/_visibility|_policy|null|undefined/);
      expect(line.href.startsWith("/")).toBe(true);
    }
  });

  it("states the platform defaults correctly", () => {
    const lines = visibilitySummary({});
    const by = (k: string) => lines.find((l) => l.key === k)!;
    expect(by("profile").statement).toContain("Anyone");
    // Friends default CLOSED (0112) — the one connection list that does.
    expect(by("friends").statement).toContain("Your friends");
    expect(by("messages").statement).toContain("Your followers");
  });

  // A hidden account is friends-only whatever its own setting says.
  it("reports the STRICTER of an admin hide and the member's own setting", () => {
    const line = visibilitySummary({ isHidden: true, profileVisibility: "public" }).find((l) => l.key === "profile")!;
    expect(line.statement).toContain("Only your friends");
    expect(line.level).toBe("limited");
  });

  it("says plainly when only an exact username finds you", () => {
    const line = visibilitySummary({ discoverable: false }).find((l) => l.key === "search")!;
    expect(line.statement).toContain("exact @username");
    expect(line.level).toBe("closed");
  });

  it("distinguishes findable-by-location from findable-by-name", () => {
    const withLocation = visibilitySummary({ discoveryFields: ["city"] }).find((l) => l.key === "search")!;
    const without = visibilitySummary({ discoveryFields: ["skills"] }).find((l) => l.key === "search")!;
    expect(withLocation.statement).toContain("where you are");
    expect(withLocation.level).toBe("open");
    expect(without.statement).toContain("not by location");
    expect(without.level).toBe("limited");
  });

  it("reads each audience value into the right level", () => {
    const open = visibilitySummary({ activityVisibility: "public" }).find((l) => l.key === "activity")!;
    const limited = visibilitySummary({ activityVisibility: "followers" }).find((l) => l.key === "activity")!;
    const closed = visibilitySummary({ activityVisibility: "private" }).find((l) => l.key === "activity")!;
    expect([open.level, limited.level, closed.level]).toEqual(["open", "limited", "closed"]);
  });

  it("handles messages and comments being switched off", () => {
    const lines = visibilitySummary({ messagesPolicy: "off", commentsPolicy: "off" });
    expect(lines.find((l) => l.key === "messages")!.statement).toContain("Nobody");
    expect(lines.find((l) => l.key === "comments")!.level).toBe("closed");
  });

  it("reports search-engine indexing both ways", () => {
    expect(visibilitySummary({ allowIndexing: false }).find((l) => l.key === "indexing")!.level).toBe("closed");
    expect(visibilitySummary({ allowIndexing: true }).find((l) => l.key === "indexing")!.level).toBe("open");
  });

  it("never invents a value for a missing column", () => {
    const lines = visibilitySummary({ activityVisibility: null, followersVisibility: undefined });
    for (const l of lines) expect(l.statement).not.toContain("undefined");
  });
});

describe("headline and counts", () => {
  it("counts the levels", () => {
    const counts = countLevels(visibilitySummary({}));
    expect(counts.open + counts.limited + counts.closed).toBe(visibilitySummary({}).length);
  });

  it("says most is public for a wide-open account", () => {
    const lines = visibilitySummary({
      activityVisibility: "public",
      followersVisibility: "public",
      friendsVisibility: "public",
      followingVisibility: "public",
      commentsPolicy: "everyone",
      messagesPolicy: "everyone",
      allowIndexing: true,
      discoverable: true,
      discoveryFields: ["city"],
    });
    expect(visibilityHeadline(lines)).toMatch(/public/i);
  });

  it("says nothing is public for a locked-down account", () => {
    const lines = visibilitySummary({
      profileVisibility: "private",
      activityVisibility: "private",
      followersVisibility: "private",
      friendsVisibility: "private",
      followingVisibility: "private",
      commentsPolicy: "off",
      messagesPolicy: "off",
      allowIndexing: false,
      showInRecommendations: false,
      discoverable: false,
    });
    expect(countLevels(lines).open).toBe(0);
    expect(visibilityHeadline(lines)).toMatch(/closed down tight|Nothing about you/);
  });

  // `open` marks the widest choice, never a mistake — a screen that scolds a
  // creator for being findable teaches them to ignore every warning.
  it("treats public as a level, not a verdict", () => {
    for (const line of visibilitySummary({})) {
      expect(line.statement.toLowerCase()).not.toMatch(/warning|danger|unsafe|risk|you should/);
    }
  });
});
