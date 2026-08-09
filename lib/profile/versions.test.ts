import { describe, expect, it } from "vitest";

import {
  diffSnapshots,
  isWorthVersioning,
  MAX_VERSIONS,
  readSnapshot,
  versionLabel,
  type ProfileSnapshot,
} from "@/lib/profile/versions";
import { PROFILE_SERVICES, backendOnlyServices, liveServices, profileService, profileTables } from "@/lib/profile/os";

const base: ProfileSnapshot = {
  type: "personal",
  landing: "posts",
  modules: [
    { key: "posts", enabled: true, position: 0, audience: "public" },
    { key: "about", enabled: true, position: 1, audience: "public" },
    { key: "saved", enabled: false, position: 2, audience: "private" },
  ],
  theme: null,
  surface: null,
  radius: null,
  fontScale: null,
};

const snap = (over: Partial<ProfileSnapshot> = {}): ProfileSnapshot => ({ ...base, ...over });

describe("diffSnapshots", () => {
  it("calls the first save the first version", () => {
    expect(diffSnapshots(null, base)).toEqual([{ kind: "type", text: "First saved version" }]);
  });

  it("sees nothing when nothing changed", () => {
    expect(diffSnapshots(base, snap())).toEqual([]);
  });

  it("names an appearance change", () => {
    expect(diffSnapshots(base, snap({ theme: "midnight" }))[0]!.text).toContain("midnight");
    expect(diffSnapshots(base, snap({ surface: "glass" }))[0]!.text).toContain("glass");
  });

  it("says 'reset to default' when a value is cleared", () => {
    const before = snap({ theme: "midnight" });
    expect(diffSnapshots(before, snap({ theme: null }))[0]!.text).toContain("reset to default");
  });

  it("reports sections turned on and off", () => {
    const after = snap({
      modules: [
        { key: "posts", enabled: false, position: 0, audience: "public" },
        { key: "about", enabled: true, position: 1, audience: "public" },
        { key: "saved", enabled: true, position: 2, audience: "private" },
      ],
    });
    const changes = diffSnapshots(base, after);
    expect(changes.some((c) => c.text === "Turned on saved")).toBe(true);
    expect(changes.some((c) => c.text === "Turned off posts")).toBe(true);
  });

  it("counts audience changes rather than listing them", () => {
    const after = snap({
      modules: base.modules.map((m) => ({ ...m, audience: "friend" })),
    });
    const change = diffSnapshots(base, after).find((c) => c.kind === "audience")!;
    expect(change.text).toContain("3 sections");
  });

  // Eleven shuffled rows is noise, not information.
  it("collapses a reorder to one line", () => {
    const after = snap({
      modules: [
        { key: "about", enabled: true, position: 0, audience: "public" },
        { key: "posts", enabled: true, position: 1, audience: "public" },
        { key: "saved", enabled: false, position: 2, audience: "private" },
      ],
    });
    const changes = diffSnapshots(base, after);
    expect(changes.filter((c) => c.kind === "order")).toHaveLength(1);
  });

  it("does not also report a reorder when sections were toggled", () => {
    const after = snap({
      modules: [
        { key: "about", enabled: true, position: 0, audience: "public" },
        { key: "posts", enabled: false, position: 1, audience: "public" },
        { key: "saved", enabled: false, position: 2, audience: "private" },
      ],
    });
    expect(diffSnapshots(base, after).some((c) => c.kind === "order")).toBe(false);
  });

  it("handles a module appearing or disappearing entirely", () => {
    const added = snap({ modules: [...base.modules, { key: "reels", enabled: true, position: 3, audience: "public" }] });
    expect(diffSnapshots(base, added).some((c) => c.text.includes("reels"))).toBe(true);

    const removed = snap({ modules: base.modules.slice(1) });
    expect(diffSnapshots(base, removed).some((c) => c.text.includes("posts"))).toBe(true);
  });

  it("reports a landing change both ways", () => {
    expect(diffSnapshots(base, snap({ landing: "about" }))[0]!.text).toContain("about");
    expect(diffSnapshots(base, snap({ landing: null }))[0]!.text).toContain("automatic");
  });

  it("reports a type change", () => {
    expect(diffSnapshots(base, snap({ type: "business" }))[0]!.text).toContain("business");
  });
});

describe("versionLabel", () => {
  it("uses the single change verbatim", () => {
    expect(versionLabel(diffSnapshots(base, snap({ theme: "midnight" })))).toContain("midnight");
  });

  it("summarises several changes", () => {
    const label = versionLabel(diffSnapshots(base, snap({ theme: "midnight", surface: "glass", radius: "sharp" })));
    expect(label).toContain("+2 more");
  });

  it("says so when nothing visible changed", () => {
    expect(versionLabel([])).toBe("No visible change");
  });
});

describe("isWorthVersioning", () => {
  it("always records the first version", () => {
    expect(isWorthVersioning(null, base)).toBe(true);
  });

  // A list full of "No visible change" hides the entries that matter.
  it("does not record a save that changed nothing", () => {
    expect(isWorthVersioning(base, snap())).toBe(false);
  });

  it("records a real change", () => {
    expect(isWorthVersioning(base, snap({ theme: "aurora" }))).toBe(true);
  });
});

describe("readSnapshot", () => {
  it("round-trips a valid snapshot", () => {
    expect(readSnapshot(base)).toEqual(base);
  });

  it("rejects anything without a type", () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({})).toBeNull();
    expect(readSnapshot("nonsense")).toBeNull();
    expect(readSnapshot({ modules: [] })).toBeNull();
  });

  it("drops malformed module rows rather than failing the whole restore", () => {
    const parsed = readSnapshot({ type: "personal", modules: [{ key: "posts" }, {}, null, { position: 2 }] });
    expect(parsed!.modules).toHaveLength(1);
    expect(parsed!.modules[0]).toEqual({ key: "posts", enabled: true, position: 0, audience: "public" });
  });

  it("normalises empty strings to null", () => {
    const parsed = readSnapshot({ type: "personal", theme: "", surface: null, modules: [] });
    expect(parsed!.theme).toBeNull();
    expect(parsed!.surface).toBeNull();
  });

  it("keeps history bounded", () => {
    expect(MAX_VERSIONS).toBeGreaterThan(5);
    expect(MAX_VERSIONS).toBeLessThanOrEqual(50);
  });
});

describe("Profile OS service map", () => {
  it("has no duplicate keys and every one resolves", () => {
    const keys = PROFILE_SERVICES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(profileService(k)).toBeDefined();
  });

  it("every live or backend service names an owner and a part", () => {
    for (const s of [...liveServices(), ...backendOnlyServices()]) {
      expect(s.owner, s.key).not.toBe("—");
      expect(s.part).toBeGreaterThan(0);
    }
  });

  // A roadmap item refused without a reason is just a gap with better PR.
  it("every declined service says exactly why, at length", () => {
    for (const s of PROFILE_SERVICES.filter((x) => x.status === "declined")) {
      expect(s.reason, s.key).toBeTruthy();
      expect(s.reason!.length).toBeGreaterThan(80);
    }
  });

  it("declined services claim no owner and no tables", () => {
    for (const s of PROFILE_SERVICES.filter((x) => x.status === "declined")) {
      expect(s.tables).toEqual([]);
      expect(s.owner).toBe("—");
    }
  });

  it("surfaces the nearly-done work separately from the live work", () => {
    expect(backendOnlyServices().length).toBeGreaterThan(0);
    for (const s of backendOnlyServices()) expect(s.tables.length).toBeGreaterThan(0);
  });

  it("lists the profile's tables, deduped and sorted", () => {
    const tables = profileTables();
    expect(new Set(tables).size).toBe(tables.length);
    expect([...tables].sort()).toEqual(tables);
    expect(tables).toContain("profiles");
    expect(tables).toContain("profile_versions");
  });
});
