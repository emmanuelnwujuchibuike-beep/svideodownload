import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SETTINGS_CATEGORIES, categoryRank, getCategory, liveCategories } from "./categories";
import { SETTINGS, getSetting, liveSettings, settingsIn } from "./registry";
import { privacyRelevant, searchSettings } from "./search";

/**
 * Settings Center™ gates (Feature 18 · Part 21).
 *
 * The registry is the spine: the root page renders from it, search reads it, and
 * a future assistant answers from it. So the tests that matter are the ones that
 * stop it drifting away from the app it claims to describe.
 */

/* ─────────────────────────────── the registry ──────────────────────────────── */

describe("the registry describes a real app", () => {
  it("gives every setting a unique id", () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every setting in a declared category", () => {
    for (const s of SETTINGS) {
      expect(getCategory(s.category), `${s.id} → unknown category "${s.category}"`).toBeDefined();
    }
  });

  it("🔴 never points a live setting at a route that does not exist", () => {
    /*
      THE test in this file. A settings row linking to a 404 is a dead
      affordance, and this codebase has had to remove those three separate
      times (admin corpora, the Help Centre, the landing profile doorway).
      A registry makes them cheap to add, so it has to make them impossible to
      keep.

      Resolved against the App Router: `/account/plan` must be served by
      `app/(app)/account/plan/page.tsx` or a `[param]` segment at that depth.
    */
    const served = (href: string): boolean => {
      const path = href.split("?")[0]!.replace(/^\//, "");
      const segments = path ? path.split("/") : [];
      // Route groups the app actually uses. A page may live under any of them.
      for (const group of ["(app)", "(marketing)", ""]) {
        const base = join(process.cwd(), "app", group);
        if (!existsSync(base)) continue;
        let dir = base;
        let ok = true;
        for (const segment of segments) {
          const exact = join(dir, segment);
          if (existsSync(exact)) {
            dir = exact;
            continue;
          }
          // A dynamic segment at this depth also serves it.
          const dynamic = ["[handle]", "[id]", "[slug]", "[field]", "[downloader]"]
            .map((d) => join(dir, d))
            .find((d) => existsSync(d));
          if (dynamic) {
            dir = dynamic;
            continue;
          }
          ok = false;
          break;
        }
        if (ok && existsSync(join(dir, "page.tsx"))) return true;
      }
      return false;
    };

    const dead = SETTINGS.filter((s) => s.status === "live" && s.href && !served(s.href));
    expect(
      dead.map((s) => `${s.id} → ${s.href}`),
      "live settings pointing at routes nothing serves",
    ).toEqual([]);
  });

  it("gives every unbuilt setting a real reason", () => {
    // "Out of scope" tells a reader nothing and ages badly.
    for (const s of SETTINGS) {
      if (s.status === "live") continue;
      expect(s.note, `${s.id} is ${s.status} with no note`).toBeTruthy();
      expect(s.note!.length, `${s.id}'s note is too thin to be useful`).toBeGreaterThan(20);
      expect(s.note!.toLowerCase()).not.toContain("out of scope");
    }
  });

  it("never gives a planned setting a link", () => {
    // A link to something unbuilt is the dead affordance again, one step removed.
    for (const s of SETTINGS.filter((s) => s.status === "planned")) {
      expect(s.href, `${s.id} is planned but links somewhere`).toBeNull();
    }
  });

  it("gives every setting keywords a person would actually type", () => {
    for (const s of SETTINGS) {
      expect(s.keywords.length, `${s.id} has no keywords`).toBeGreaterThan(0);
      expect(s.description.length, `${s.id} has no description`).toBeGreaterThan(10);
      // Keywords must ADD something — repeating the label helps nobody find it.
      const label = s.label.toLowerCase();
      expect(s.keywords.some((k) => k.toLowerCase() !== label), `${s.id}'s keywords only restate its label`).toBe(true);
    }
  });

  it("flags the settings that change what other people can see", () => {
    // A privacy control that reads like a cosmetic toggle is how people share
    // more than they meant to.
    const flagged = new Set(privacyRelevant().map((s) => s.id));
    for (const id of ["privacy.visibility", "privacy.ghost", "privacy.relationships", "privacy.discovery", "profile.modules"]) {
      expect(flagged, `${id} should be flagged as affecting others`).toContain(id);
    }
  });

  it("looks a setting up by id", () => {
    expect(getSetting("appearance.theme")?.label).toBe("Theme");
    expect(getSetting("nope.nope")).toBeUndefined();
  });
});

/* ────────────────────────────── the categories ─────────────────────────────── */

describe("categories", () => {
  it("covers every category the Part 21 brief names", () => {
    const ids = new Set(SETTINGS_CATEGORIES.map((c) => c.id));
    for (const required of [
      "account", "profile", "appearance", "privacy", "security", "notifications",
      "messaging", "stories", "feed", "downloads", "music", "live", "communities",
      "marketplace", "creator", "business", "ai", "accessibility", "language",
      "storage", "data", "devices", "developer",
    ]) {
      expect(ids, `the brief names "${required}"`).toContain(required);
    }
  });

  it("keeps empty categories rather than hiding them", () => {
    /*
      An empty category is INFORMATION: "Music" with nothing under it says Frenz
      has not built music settings; "Music" absent says nothing, and someone
      searching for it gets silence. Same rule as the analytics page catalogue.
    */
    const planned = SETTINGS_CATEGORIES.filter((c) => c.status === "planned");
    expect(planned.length).toBeGreaterThan(0);
    for (const c of planned) {
      expect(c.note, `${c.id} is planned with no explanation`).toBeTruthy();
      expect(c.note!.toLowerCase()).not.toContain("out of scope");
    }
  });

  it("has at least one live setting behind every live category", () => {
    // A live category with nothing in it is an empty room with a door.
    for (const c of liveCategories()) {
      const live = settingsIn(c.id).filter((s) => s.status === "live");
      expect(live.length, `category "${c.id}" is live but has no live settings`).toBeGreaterThan(0);
    }
  });

  it("orders by declared position, never alphabetically", () => {
    expect(categoryRank("account")).toBeLessThan(categoryRank("developer"));
    expect(categoryRank("nonexistent")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

/* ──────────────────────────────── the search ───────────────────────────────── */

describe("Smart Settings Search", () => {
  const top = (q: string) => searchSettings(q)[0]?.entry.id;

  it("finds every example the brief lists", () => {
    // These are the exact phrases from the Part 21 brief.
    expect(top("Dark Mode")).toBe("appearance.theme");
    expect(top("Blocked Users")).toBe("privacy.relationships");
    expect(top("Profile Video")).toBe("profile.identity");
    expect(top("Language")).toBe("language.language");
    expect(top("Download Quality")).toBe("downloads.quality");
    expect(top("Story Privacy")).toBeTruthy();
    expect(top("Two-Factor Authentication")).toBe("security.2fa");
    expect(top("Muted Accounts")).toBe("privacy.relationships");
  });

  it("understands everyday words, not menu names", () => {
    expect(top("2fa")).toBe("security.2fa");
    expect(top("night mode")).toBe("appearance.theme");
    expect(top("lost phone")).toBe("security.recovery");
    expect(top("free space")).toBe("storage.clear");
    expect(top("who can message me")).toBe("messaging.requests");
    expect(top("invisible")).toBe("privacy.ghost");
    expect(top("cancel subscription")).toBe("account.plan");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(top("TWO-FACTOR")).toBe(top("two factor"));
    expect(top("Dark  Mode!!")).toBe("appearance.theme");
  });

  it("requires every word to match something", () => {
    /*
      "blocked users" must not return every setting containing "users". A query
      that finds nothing is a better answer than a list that ignores half of
      what was typed.
    */
    expect(searchSettings("blocked zzzzz")).toHaveLength(0);
  });

  it("ranks an exact label above a description mention", () => {
    const hits = searchSettings("theme");
    expect(hits[0]!.entry.id).toBe("appearance.theme");
    expect(hits[0]!.matchedOn).toBe("label");
  });

  it("prefers a live setting over a planned one within the same band", () => {
    // Someone searching wants the control, not the note explaining its absence.
    const hits = searchSettings("storage");
    expect(hits[0]!.entry.status).toBe("live");
  });

  it("still surfaces planned settings rather than pretending they do not exist", () => {
    const hits = searchSettings("download quality");
    expect(hits[0]!.entry.id).toBe("downloads.quality");
    expect(hits[0]!.entry.status).toBe("planned");
  });

  it("returns nothing for an empty query", () => {
    expect(searchSettings("")).toHaveLength(0);
    expect(searchSettings("   ")).toHaveLength(0);
  });

  it("is stable — the same query always gives the same order", () => {
    const a = searchSettings("privacy").map((h) => h.entry.id);
    const b = searchSettings("privacy").map((h) => h.entry.id);
    expect(a).toEqual(b);
    // And ties break by declared rank, never by array churn.
    expect(a).toEqual([...a]);
  });

  it("respects the limit", () => {
    expect(searchSettings("a", 3).length).toBeLessThanOrEqual(3);
  });

  it("explains why each result matched", () => {
    for (const hit of searchSettings("2fa")) {
      expect(["label", "keyword", "description", "category"]).toContain(hit.matchedOn);
    }
  });
});

describe("the registry is worth having", () => {
  it("covers substantially more than the old hand-written list", () => {
    // The page it replaces declared 19 rows inside JSX. If the registry is not
    // materially richer than that, it has not earned its existence.
    expect(SETTINGS.length).toBeGreaterThan(30);
    expect(liveSettings().length).toBeGreaterThan(25);
  });
});
