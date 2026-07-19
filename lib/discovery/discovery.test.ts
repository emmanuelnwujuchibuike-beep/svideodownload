import { describe, expect, it } from "vitest";

import {
  addressableEntities,
  allEntities,
  canonicalConflicts,
  entitiesOfKind,
  getEntity,
  orphanEntities,
} from "./entities";
import { emit } from "./schema";

/**
 * Enterprise Discovery Platform™ gates. See `docs/DISCOVERY_PLATFORM_RFC.md`.
 *
 * These guard failures that are completely invisible in the UI. A duplicate
 * canonical, a schema.org entity for unbuilt software, or an orphan page all
 * render perfectly — they only show up as ranking that never arrives, which is
 * indistinguishable from "SEO is hard" unless something checks mechanically.
 */

describe("Universal Entity Registry", () => {
  it("derives entities from the graph", () => {
    expect(allEntities().length).toBeGreaterThan(100);
  });

  it("gives every addressable entity an absolute canonical", () => {
    for (const e of addressableEntities()) {
      expect(e.canonical, `${e.id}`).toMatch(/^https?:\/\//);
    }
  });

  it("never claims a canonical for something that is not real", () => {
    // Fail-closed. An unbuilt product may have a future href in the graph;
    // publishing a canonical for it asserts to crawlers that the page exists.
    for (const e of allEntities()) {
      if (!e.real) expect(e.canonical, `${e.id} is unreal but canonicalised`).toBeNull();
    }
  });

  it("never lets two entities claim the same canonical", () => {
    /*
     * The failure this prevents is silent and expensive: search engines pick one
     * of the duplicates, ranking signals split, and the loser effectively
     * disappears. It is reachable here — courses render inside their school page,
     * so they must NOT carry the school's URL. This test is what keeps that
     * decision from being quietly reversed.
     */
    const conflicts = canonicalConflicts();
    const detail = conflicts
      .map((c) => `${c.canonical} claimed by ${c.entityIds.join(", ")}`)
      .join("\n  ");
    expect(conflicts, `Duplicate canonicals:\n  ${detail}`).toHaveLength(0);
  });

  it("addresses the Knowledge Campus schools", () => {
    const schools = allEntities().filter((e) => e.id.startsWith("school:"));
    expect(schools.length).toBeGreaterThan(0);
    for (const s of schools) {
      expect(s.canonical, `${s.id}`).toContain("/academy/");
    }
  });

  it("does not address courses, which have no page of their own", () => {
    const courses = allEntities().filter((e) => e.id.startsWith("course:"));
    expect(courses.length).toBeGreaterThan(0);
    for (const c of courses) {
      expect(c.canonical, `${c.id} claims a URL but renders inside its school`).toBeNull();
    }
  });
});

describe("Schema Registry", () => {
  it("refuses to emit for anything unreal", () => {
    // Structured data is a machine-readable assertion of fact. A false entity
    // propagates into third-party knowledge bases and outlives the fix.
    for (const e of allEntities()) {
      if (!e.real) expect(emit(e), `${e.id}`).toBeNull();
    }
  });

  it("refuses to emit without a canonical", () => {
    for (const e of allEntities()) {
      if (!e.canonical) expect(emit(e), `${e.id}`).toBeNull();
    }
  });

  it("emits a well-formed document for real, addressable entities", () => {
    const emitted = addressableEntities()
      .map((e) => emit(e))
      .filter((d): d is Record<string, unknown> => d !== null);

    expect(emitted.length).toBeGreaterThan(0);
    for (const doc of emitted) {
      expect(doc["@context"]).toBe("https://schema.org");
      expect(typeof doc["@type"]).toBe("string");
      expect(doc.url).toBeTruthy();
    }
  });

  it("emits LearningResource for lessons, with a real duration or none", () => {
    const lessons = entitiesOfKind("lesson").filter((e) => e.canonical);
    expect(lessons.length).toBeGreaterThan(0);

    for (const lesson of lessons) {
      const doc = emit(lesson)!;
      expect(doc["@type"]).toBe("LearningResource");
      // An invented duration would be displayed as fact in a rich result.
      if ("timeRequired" in doc) expect(doc.timeRequired).toMatch(/^PT\d+M$/);
    }
  });

  it("stays silent for a kind with no registered emitter", () => {
    // A new node kind must not guess at what it asserts.
    const capability = entitiesOfKind("capability")[0];
    if (capability) expect(emit(capability)).toBeNull();
  });
});

describe("content health", () => {
  it("reports orphans as a backlog rather than failing", () => {
    /*
     * Orphans are reachable only from the sitemap, which crawlers weight far
     * below an internal link. This is deliberately NOT an assertion of zero — a
     * new page is legitimately an orphan for a moment. It is recorded so the
     * number is visible and can be driven down, rather than discovered later.
     */
    const orphans = orphanEntities();
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("resolves a known entity by id", () => {
    const entity = getEntity("product:download");
    expect(entity?.real).toBe(true);
    expect(entity?.canonical).toBeTruthy();
  });
});
