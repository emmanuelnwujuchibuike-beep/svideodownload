import { describe, expect, it } from "vitest";

import { canSeeModule, resolveViewerRole } from "@/lib/profile/audience";
import { canEnableModule, effectiveModules, resolveProfileLayout, type StoredModule } from "@/lib/profile/engine";
import { LIVE_MODULE_KEYS, modulesForType, PROFILE_MODULES, profileModule } from "@/lib/profile/modules";
import { isSelectableProfileType, PROFILE_TYPES, profileType } from "@/lib/profile/profile-types";

const ALL_CONTENT = Object.fromEntries(LIVE_MODULE_KEYS.map((k) => [k, true]));

describe("profile type registry", () => {
  it("every type's default modules exist and are live", () => {
    for (const t of PROFILE_TYPES) {
      for (const key of t.defaultModules) {
        const spec = profileModule(key);
        expect(spec, `${t.key} defaults to unknown module ${key}`).toBeDefined();
        expect(spec!.status, `${t.key} defaults to non-live module ${key}`).toBe("live");
      }
    }
  });

  it("every type's landing module is one it enables by default", () => {
    for (const t of PROFILE_TYPES) {
      expect(t.defaultModules, `${t.key} lands on a module it doesn't enable`).toContain(t.defaultLanding);
    }
  });

  it("every default module is actually offered to that type", () => {
    for (const t of PROFILE_TYPES) {
      const offered = new Set(modulesForType(t.key).map((m) => m.key));
      for (const key of t.defaultModules) {
        expect(offered.has(key), `${t.key} defaults to ${key}, which its type doesn't offer`).toBe(true);
      }
    }
  });

  it("falls back to personal for unknown or missing types", () => {
    expect(profileType(null).key).toBe("personal");
    expect(profileType("wizard").key).toBe("personal");
  });

  it("declared-for-later types are not selectable", () => {
    expect(isSelectableProfileType("government")).toBe(false);
    expect(isSelectableProfileType("education")).toBe(false);
    expect(isSelectableProfileType("business")).toBe(true);
  });
});

describe("module catalogue", () => {
  it("has no duplicate keys", () => {
    const keys = PROFILE_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("planned modules say what they need, live ones don't", () => {
    for (const m of PROFILE_MODULES) {
      if (m.status === "planned") expect(m.needs, `${m.key} is planned but doesn't say why`).toBeTruthy();
      else expect(m.needs, `${m.key} is live but claims to need a backend`).toBeUndefined();
    }
  });
});

describe("viewer role", () => {
  const base = { viewerId: "v", isOwner: false, isAdmin: false, isFriend: false, isFollowing: false };

  it("takes the highest applicable role", () => {
    expect(resolveViewerRole({ ...base, isOwner: true, isAdmin: true })).toBe("owner");
    expect(resolveViewerRole({ ...base, isAdmin: true, isFriend: true })).toBe("admin");
    expect(resolveViewerRole({ ...base, isFriend: true, isFollowing: true })).toBe("friend");
    expect(resolveViewerRole({ ...base, isFollowing: true })).toBe("follower");
    expect(resolveViewerRole(base)).toBe("member");
    expect(resolveViewerRole({ ...base, viewerId: null })).toBe("anon");
  });
});

describe("module audience", () => {
  it("owner sees everything, including their own private modules", () => {
    expect(canSeeModule("owner", "private")).toBe(true);
    expect(canSeeModule("owner", "friend")).toBe(true);
  });

  it("a private module is invisible to everyone else — moderators included", () => {
    for (const role of ["admin", "friend", "follower", "member", "anon"] as const) {
      expect(canSeeModule(role, "private"), `${role} could see a private module`).toBe(false);
    }
  });

  it("friends-only excludes plain followers", () => {
    expect(canSeeModule("friend", "friend")).toBe(true);
    expect(canSeeModule("follower", "friend")).toBe(false);
  });

  it("followers-only includes friends (a friend is closer than a follower)", () => {
    expect(canSeeModule("friend", "follower")).toBe(true);
    expect(canSeeModule("member", "follower")).toBe(false);
  });

  it("members-only excludes signed-out visitors", () => {
    expect(canSeeModule("member", "member")).toBe(true);
    expect(canSeeModule("anon", "member")).toBe(false);
    expect(canSeeModule("anon", "public")).toBe(true);
  });
});

describe("effectiveModules", () => {
  it("gives an unconfigured profile its type's defaults, in order", () => {
    const on = effectiveModules("business", []).filter((m) => m.enabled).map((m) => m.key);
    expect(on).toEqual(profileType("business").defaultModules);
  });

  it("only offers modules the type actually has", () => {
    const personal = effectiveModules("personal", []).map((m) => m.key);
    expect(personal).not.toContain("catalog");
    expect(personal).not.toContain("experience");
    expect(effectiveModules("business", []).map((m) => m.key)).toContain("catalog");
  });

  it("never offers a planned module", () => {
    for (const t of PROFILE_TYPES) {
      for (const m of effectiveModules(t.key, [])) {
        expect(m.spec.status).toBe("live");
      }
    }
  });

  it("stored rows override the defaults", () => {
    const stored: StoredModule[] = [
      { moduleKey: "posts", enabled: false, position: 0, audience: "public" },
      { moduleKey: "about", enabled: true, position: 1, audience: "friend" },
    ];
    const map = new Map(effectiveModules("personal", stored).map((m) => [m.key, m]));
    expect(map.get("posts")!.enabled).toBe(false);
    expect(map.get("about")!.audience).toBe("friend");
    // Untouched modules keep their type default rather than switching off.
    expect(map.get("reels")!.enabled).toBe(true);
  });
});

describe("resolveProfileLayout", () => {
  const owner = { type: "creator" as const, stored: [], landing: null, role: "owner" as const, content: {} };

  it("keeps EMPTY modules for the owner and hides them from visitors", () => {
    const mine = resolveProfileLayout(owner);
    expect(mine.modules.map((m) => m.key)).toContain("achievements");

    const theirs = resolveProfileLayout({ ...owner, role: "anon" });
    expect(theirs.modules).toHaveLength(0);
  });

  it("shows a visitor only the modules that hold something", () => {
    const out = resolveProfileLayout({ ...owner, role: "anon", content: { posts: true, about: true } });
    expect(out.modules.map((m) => m.key)).toEqual(["posts", "about"]);
  });

  it("honours per-module audience for the viewer's real relationship", () => {
    const stored: StoredModule[] = [{ moduleKey: "about", enabled: true, position: 0, audience: "friend" }];
    const input = { ...owner, stored, content: { about: true, posts: true } };
    expect(resolveProfileLayout({ ...input, role: "friend" }).modules.map((m) => m.key)).toContain("about");
    expect(resolveProfileLayout({ ...input, role: "follower" }).modules.map((m) => m.key)).not.toContain("about");
  });

  it("a private module never reaches a visitor even with content", () => {
    const stored: StoredModule[] = [{ moduleKey: "posts", enabled: true, position: 0, audience: "private" }];
    const out = resolveProfileLayout({ ...owner, stored, role: "friend", content: ALL_CONTENT });
    expect(out.modules.map((m) => m.key)).not.toContain("posts");
  });

  it("legacy per-tab privacy still governs Reposts/Wows/Saved", () => {
    const stored: StoredModule[] = [
      { moduleKey: "liked", enabled: true, position: 0, audience: "public" },
      { moduleKey: "saved", enabled: true, position: 1, audience: "public" },
    ];
    const input = { ...owner, stored, role: "member" as const, content: ALL_CONTENT };
    // Enabled as a module, but the older Likes privacy setting says no.
    expect(resolveProfileLayout(input).modules.map((m) => m.key)).not.toContain("liked");
    // Allowed by that setting → it comes through.
    const allowed = resolveProfileLayout({ ...input, allowedGoverned: ["liked"] });
    expect(allowed.modules.map((m) => m.key)).toContain("liked");
    expect(allowed.modules.map((m) => m.key)).not.toContain("saved");
  });

  it("respects the member's order", () => {
    const stored: StoredModule[] = [
      { moduleKey: "about", enabled: true, position: 0, audience: "public" },
      { moduleKey: "posts", enabled: true, position: 1, audience: "public" },
    ];
    const out = resolveProfileLayout({ ...owner, stored, role: "anon", content: { about: true, posts: true } });
    expect(out.modules.map((m) => m.key)).toEqual(["about", "posts"]);
  });

  it("lands on the member's choice when the viewer can see it", () => {
    const out = resolveProfileLayout({ ...owner, landing: "about", role: "anon", content: { posts: true, about: true } });
    expect(out.landing).toBe("about");
  });

  it("falls back when the chosen landing module is hidden from this viewer", () => {
    const stored: StoredModule[] = [{ moduleKey: "about", enabled: true, position: 9, audience: "friend" }];
    const out = resolveProfileLayout({
      ...owner,
      stored,
      landing: "about",
      role: "anon",
      content: { posts: true, about: true },
    });
    expect(out.landing).toBe("posts"); // the creator type's default, still visible
    expect(out.modules.map((m) => m.key)).not.toContain("about");
  });

  it("lands on nothing when nothing is visible", () => {
    expect(resolveProfileLayout({ ...owner, role: "anon" }).landing).toBeNull();
  });

  it("the landing module is always one of the visible modules", () => {
    for (const t of PROFILE_TYPES) {
      for (const role of ["owner", "anon", "member", "follower", "friend", "admin"] as const) {
        const out = resolveProfileLayout({ type: t.key, stored: [], landing: null, role, content: ALL_CONTENT });
        if (out.landing) expect(out.modules.map((m) => m.key)).toContain(out.landing);
      }
    }
  });
});

describe("canEnableModule", () => {
  it("rejects unknown keys and modules another type doesn't offer", () => {
    expect(canEnableModule("business", "nope")).toBe(false); // unknown
    expect(canEnableModule("personal", "catalog")).toBe(false); // wrong type
    expect(canEnableModule("business", "catalog")).toBe(true);
    expect(canEnableModule("personal", "posts")).toBe(true);
    // Reviews gained a backend in migration 0110, so a business profile can
    // now enable it. (It was the `planned` example here until then.)
    expect(canEnableModule("business", "reviews")).toBe(true);
  });

  it("rejects any module still marked planned, whatever it is", () => {
    // Written against the REGISTRY rather than a hardcoded key, so this keeps
    // holding as modules gain backends — the rule is what matters, not which
    // module happens to be unbuilt today.
    for (const m of PROFILE_MODULES.filter((x) => x.status === "planned")) {
      const type = m.types === "all" ? "personal" : m.types[0]!;
      expect(canEnableModule(type, m.key), `${m.key} is planned but enableable`).toBe(false);
    }
  });
});

describe("circle audiences (Part 17)", () => {
  const CIRCLE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const OTHER = "9f8b0c11-2d33-4e55-a677-0011223344ff";
  const audience = `circle:${CIRCLE}`;

  it("shows a circle-gated module only to a member of that exact circle", () => {
    expect(canSeeModule("friend", audience, { viewerCircles: new Set([CIRCLE]) })).toBe(true);
    expect(canSeeModule("friend", audience, { viewerCircles: new Set([OTHER]) })).toBe(false);
    expect(canSeeModule("friend", audience, { viewerCircles: new Set() })).toBe(false);
  });

  // Fail-closed: no context at all must never mean "let them in".
  it("hides it when membership is unknown", () => {
    expect(canSeeModule("friend", audience)).toBe(false);
    expect(canSeeModule("anon", audience)).toBe(false);
    expect(canSeeModule("member", audience)).toBe(false);
  });

  it("hides it from moderators — a circle is not published content", () => {
    expect(canSeeModule("admin", audience, { viewerCircles: new Set() })).toBe(false);
  });

  it("always shows it to the owner", () => {
    expect(canSeeModule("owner", audience)).toBe(true);
  });

  it("hides a malformed circle audience rather than opening it", () => {
    for (const bad of ["circle:", "circle:not-a-uuid", "circle:' or 1=1--", "circle:undefined"]) {
      expect(canSeeModule("friend", bad, { viewerCircles: new Set([CIRCLE]) }), bad).toBe(false);
    }
  });

  it("leaves the built-in audiences untouched", () => {
    expect(canSeeModule("follower", "public")).toBe(true);
    expect(canSeeModule("anon", "member")).toBe(false);
    expect(canSeeModule("friend", "friend")).toBe(true);
    expect(canSeeModule("admin", "private")).toBe(false);
  });

  it("the engine hides a circle-gated module from a non-member", () => {
    const stored: StoredModule[] = [
      { moduleKey: "about", enabled: true, position: 0, audience },
      { moduleKey: "posts", enabled: true, position: 1, audience: "public" },
    ];
    const outsider = resolveProfileLayout({
      type: "personal",
      stored,
      landing: null,
      role: "friend",
      content: ALL_CONTENT,
    });
    expect(outsider.modules.map((m) => m.key)).not.toContain("about");

    const insider = resolveProfileLayout({
      type: "personal",
      stored,
      landing: null,
      role: "friend",
      content: ALL_CONTENT,
      viewerCircles: new Set([CIRCLE]),
    });
    expect(insider.modules.map((m) => m.key)).toContain("about");
  });

  it("never lands a viewer on a circle-gated module they cannot see", () => {
    const layout = resolveProfileLayout({
      type: "personal",
      stored: [
        { moduleKey: "about", enabled: true, position: 0, audience },
        { moduleKey: "posts", enabled: true, position: 1, audience: "public" },
      ],
      landing: "about",
      role: "friend",
      content: ALL_CONTENT,
    });
    expect(layout.landing).toBe("posts");
  });
});
