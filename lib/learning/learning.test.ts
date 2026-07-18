import { describe, expect, it } from "vitest";

import {
  getLessonMeta,
  LESSON_CATALOG,
  LESSON_SLUGS,
  lessonForAction,
  relatedLessons,
} from "./catalog";
import { bodySlugs, getLesson, getLessons } from "./lessons";
import { GATEWAY_ACTIONS } from "@/lib/download-hub/actions";

/**
 * Learning Academy™ integrity. See `docs/DOWNLOAD_HUB_RFC.md` §4.
 *
 * Metadata (`catalog.ts`) and bodies (`lessons.ts`) are separate files for bundle
 * reasons, which introduces exactly one new failure mode: they can drift apart.
 * The first test is the one that matters — without it, adding a catalog entry and
 * forgetting the body ships a lesson that renders a title and nothing else.
 */

describe("Learning Academy — catalog and bodies agree", () => {
  it("every catalogued lesson has a body, and vice versa", () => {
    expect([...bodySlugs()].sort()).toEqual([...LESSON_SLUGS].sort());
  });

  it("resolves every slug to a complete lesson", () => {
    for (const slug of LESSON_SLUGS) {
      const lesson = getLesson(slug);
      expect(lesson, `${slug} did not resolve`).toBeDefined();
      expect(lesson!.title.length, `${slug} title`).toBeGreaterThan(0);
      expect(lesson!.intro.length, `${slug} intro`).toBeGreaterThan(0);
      expect(lesson!.sections.length, `${slug} sections`).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an unknown slug rather than a half-built lesson", () => {
    expect(getLesson("no-such-lesson")).toBeUndefined();
    expect(getLessonMeta("no-such-lesson")).toBeUndefined();
  });

  it("getLessons() returns every lesson in full", () => {
    expect(getLessons()).toHaveLength(LESSON_CATALOG.length);
    for (const l of getLessons()) expect(l.sections.length).toBeGreaterThan(0);
  });
});

describe("Learning Academy — the link graph", () => {
  it("never links to a lesson that does not exist", () => {
    // A dead "keep reading" card is a 404 in the one place we are asking for
    // more attention.
    const broken = LESSON_CATALOG.flatMap((l) =>
      l.related.filter((s) => !LESSON_SLUGS.includes(s)).map((s) => `${l.slug} → ${s}`),
    );
    expect(broken, `Broken lesson links:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("never links a lesson to itself", () => {
    for (const l of LESSON_CATALOG) expect(l.related, l.slug).not.toContain(l.slug);
  });

  it("gives every lesson at least one outbound link", () => {
    // Orphans get no internal link equity and are the thin-content risk this
    // whole cluster exists to avoid.
    for (const l of LESSON_CATALOG) {
      expect(relatedLessons(l.slug).length, `${l.slug} links nowhere`).toBeGreaterThan(0);
    }
  });

  it("only references Gateway actions that exist", () => {
    const ids = new Set(GATEWAY_ACTIONS.map((a) => a.id));
    const broken = LESSON_CATALOG.flatMap((l) =>
      l.relatedActionIds.filter((a) => !ids.has(a)).map((a) => `${l.slug} → ${a}`),
    );
    expect(broken, `Lessons referencing unknown actions:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("attaches a lesson to the Gateway actions that most need one", () => {
    // These are the actions whose whole value is "you could do more with this",
    // so a missing guide is a real gap rather than a cosmetic one.
    for (const actionId of ["edit-video", "generate-subtitles", "enhance-quality", "save-to-cloud"]) {
      expect(lessonForAction(actionId), `no lesson supports ${actionId}`).toBeDefined();
    }
  });

  it("has a unique slug per lesson", () => {
    expect(new Set(LESSON_SLUGS).size).toBe(LESSON_SLUGS.length);
  });

  it("states a plausible reading time for every lesson", () => {
    for (const l of LESSON_CATALOG) {
      expect(l.minutes, l.slug).toBeGreaterThan(0);
      expect(l.minutes, l.slug).toBeLessThan(30);
    }
  });

  it("keeps every description within a meta-description budget", () => {
    // These are rendered as <meta name="description">; over ~160 chars gets cut.
    for (const l of LESSON_CATALOG) {
      expect(l.description.length, `${l.slug} description is ${l.description.length} chars`)
        .toBeLessThanOrEqual(165);
    }
  });
});
