import { describe, expect, it } from "vitest";

import { PRIMARY_LINKS } from "./primary-links";
import { getPrimaryPages } from "./seo-pages";

/**
 * 🔴 THE HAND-MAINTAINED CLIENT CATALOGUE MUST MATCH THE GENERATED PAGES.
 *
 * `primary-links.ts` exists so CLIENT components can list the downloader pages
 * without importing `seo-pages.ts` — which would drag the whole SEO content
 * graph into the bundle and, measured, put the landing 5,742 B over its
 * cold-entry ceiling.
 *
 * A hand-copied list is only safe if something fails when it drifts. This is
 * that something: adding, removing or reordering a cluster breaks the build
 * here until the copy is updated.
 */
describe("primary link catalogue", () => {
  it("is exactly the generated primary pages, in order", () => {
    expect(PRIMARY_LINKS.map((l) => ({ slug: l.slug, platformId: l.platformId }))).toEqual(
      getPrimaryPages().map((p) => ({ slug: p.slug, platformId: p.platformId })),
    );
  });

  it("stays tiny — it is on the landing's critical path", () => {
    // Two fields per entry and nothing else. If this grows, so does every
    // client bundle that renders the nav.
    for (const link of PRIMARY_LINKS) {
      expect(Object.keys(link).sort()).toEqual(["platformId", "slug"]);
    }
  });
});
