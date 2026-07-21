import { describe, expect, it } from "vitest";

import {
  badgeExcludedTypes,
  CATEGORY_BY_TYPE,
  categoryForType,
  getNotifications,
  type NotificationCategory,
  type NotificationDef,
  typesGroupedBy,
} from "./notifications-registry";

const SNAKE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CATEGORIES: NotificationCategory[] = [
  "social",
  "downloads",
  "community",
  "news",
  "premium",
  "security",
  "system",
];

/** Pure detector, for the teeth tests. */
function registryProblems(defs: NotificationDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const n of defs) {
    if (!SNAKE.test(n.id)) problems.push(`id not snake_case: "${n.id}"`);
    if (seen.has(n.id)) problems.push(`duplicate id: "${n.id}"`);
    seen.add(n.id);
    if (!CATEGORIES.includes(n.category)) problems.push(`"${n.id}" bad category "${n.category}"`);
  }
  return problems;
}

describe("Notification Registry — integrity", () => {
  it("has unique, snake_case ids and valid categories", () => {
    const problems = registryProblems([...getNotifications()]);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Notification Registry — behaviour is preserved", () => {
  it("category muting map omits exactly the always-shown types", () => {
    // system + admin_broadcast were historically absent from CATEGORY_BY_TYPE so
    // category muting could never hide them. That must stay true.
    expect(CATEGORY_BY_TYPE.system).toBeUndefined();
    expect(CATEGORY_BY_TYPE.admin_broadcast).toBeUndefined();
    // Everything else IS mapped (so muting a category excludes it).
    const mapped = Object.keys(CATEGORY_BY_TYPE);
    expect(mapped).toContain("post_under_review"); // also "system" category, but mutable
    expect(mapped.length).toBe(getNotifications().length - 2);
  });

  it("badge-excluded types are exactly message + message_reaction", () => {
    expect(badgeExcludedTypes().sort()).toEqual(["message", "message_reaction"]);
  });

  it("grouping sets match the historical sets exactly", () => {
    expect(typesGroupedBy("post").sort()).toEqual(
      ["comment", "comment_reaction", "like", "love", "mention", "quote", "reply", "repost", "repost_engagement", "save", "share"].sort(),
    );
    expect(typesGroupedBy("together").sort()).toEqual(["follow", "profile_view"].sort());
    expect(typesGroupedBy("conversation").sort()).toEqual(
      ["message", "message_mention", "message_reaction"].sort(),
    );
  });

  it("categoryForType returns the declared category, system as the floor", () => {
    expect(categoryForType("like")).toBe("social");
    expect(categoryForType("download_complete")).toBe("downloads");
    expect(categoryForType("security_login")).toBe("security");
    expect(categoryForType("system")).toBe("system");
    expect(categoryForType("admin_broadcast")).toBe("system");
  });
});

describe("Notification Registry — the check has teeth", () => {
  it("catches a bad id, a duplicate, and an invalid category", () => {
    const broken = [
      { id: "Bad-Id", label: "x", category: "social" },
      { id: "dup", label: "x", category: "social" },
      { id: "dup", label: "x", category: "social" },
      { id: "wrong_cat", label: "x", category: "nope" },
    ] as unknown as NotificationDef[];
    const problems = registryProblems(broken);
    expect(problems.some((p) => p.includes("not snake_case"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate id"))).toBe(true);
    expect(problems.some((p) => p.includes("bad category"))).toBe(true);
  });
});
