import { describe, expect, it } from "vitest";

import {
  canAccountPublish,
  flagsOf,
  invisibleAccountIds,
  isAccountVisibleTo,
  relationTo,
  type ViewerRelation,
} from "./account-visibility";

const RELATIONS: ViewerRelation[] = ["self", "friend", "stranger"];

const normal = { isSuspended: false, isHidden: false };
const hidden = { isSuspended: false, isHidden: true };
const suspended = { isSuspended: true, isHidden: false };
const both = { isSuspended: true, isHidden: true };

describe("isAccountVisibleTo", () => {
  it("shows a normal account to everyone", () => {
    for (const rel of RELATIONS) expect(isAccountVisibleTo(normal, rel)).toBe(true);
  });

  // The owner's rule, in both directions. These two are the whole feature.
  it("keeps a hidden account visible to its friends (and itself)", () => {
    expect(isAccountVisibleTo(hidden, "friend")).toBe(true);
    expect(isAccountVisibleTo(hidden, "self")).toBe(true);
  });

  it("hides a hidden account from strangers", () => {
    expect(isAccountVisibleTo(hidden, "stranger")).toBe(false);
  });

  it("keeps a suspension a FULL lockout — friends included", () => {
    for (const rel of RELATIONS) expect(isAccountVisibleTo(suspended, rel)).toBe(false);
  });

  it("lets suspension outrank hiding when both are set", () => {
    for (const rel of RELATIONS) expect(isAccountVisibleTo(both, rel)).toBe(false);
  });

  // Exhaustive: the only (flags, relation) pairs that may EVER return true.
  it("permits visibility in exactly the allowed cases and no others", () => {
    const allowed = new Set(["normal:self", "normal:friend", "normal:stranger", "hidden:self", "hidden:friend"]);
    for (const [name, flags] of Object.entries({ normal, hidden, suspended, both })) {
      for (const rel of RELATIONS) {
        expect(isAccountVisibleTo(flags, rel), `${name} -> ${rel}`).toBe(allowed.has(`${name}:${rel}`));
      }
    }
  });
});

describe("canAccountPublish", () => {
  // The core of the owner's ask: hiding must never take an ability away.
  it("lets a hidden account keep publishing", () => {
    expect(canAccountPublish(hidden)).toBe(true);
  });

  it("stops a suspended account publishing", () => {
    expect(canAccountPublish(suspended)).toBe(false);
    expect(canAccountPublish(both)).toBe(false);
  });

  it("lets a normal account publish", () => {
    expect(canAccountPublish(normal)).toBe(true);
  });
});

describe("relationTo", () => {
  const friends = new Set(["friend-1"]);

  it("reads self, friend and stranger from the friend set", () => {
    expect(relationTo("me", "me", friends)).toBe("self");
    expect(relationTo("friend-1", "me", friends)).toBe("friend");
    expect(relationTo("nobody", "me", friends)).toBe("stranger");
  });

  it("treats an anonymous viewer as a stranger, never as a friend", () => {
    expect(relationTo("friend-1", null, friends)).toBe("stranger");
    expect(relationTo("me", null, friends)).toBe("stranger");
  });
});

describe("flagsOf", () => {
  it("treats a missing is_hidden column as not hidden (pre-migration safety)", () => {
    expect(flagsOf({ is_suspended: false })).toEqual({ isSuspended: false, isHidden: false });
  });

  it("treats null/undefined rows as unflagged", () => {
    expect(flagsOf(null)).toEqual({ isSuspended: false, isHidden: false });
    expect(flagsOf(undefined)).toEqual({ isSuspended: false, isHidden: false });
  });
});

describe("invisibleAccountIds", () => {
  const rows = [
    { id: "normal", is_suspended: false, is_hidden: false },
    { id: "hidden-friend", is_suspended: false, is_hidden: true },
    { id: "hidden-stranger", is_suspended: false, is_hidden: true },
    { id: "suspended", is_suspended: true, is_hidden: false },
    { id: "me", is_suspended: false, is_hidden: true },
  ];

  it("filters out hidden strangers and suspensions, but keeps hidden friends", () => {
    const out = invisibleAccountIds(rows, "me", new Set(["hidden-friend"]));
    expect([...out].sort()).toEqual(["hidden-stranger", "suspended"]);
  });

  it("hides every hidden account from an anonymous viewer", () => {
    const out = invisibleAccountIds(rows, null, new Set());
    expect([...out].sort()).toEqual(["hidden-friend", "hidden-stranger", "me", "suspended"]);
  });
});
