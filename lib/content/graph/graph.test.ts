import { describe, expect, it } from "vitest";

import { CLUSTERS } from "@/config/seoPages";
import { REMOVED_SEO_PAGES } from "@/lib/seo/removed-seo-pages";

import { GRAPH, buildGraph, capabilityId, productId, seoPageId, topicId } from "./build";
import { ancestors, auditGraph, graphStats, neighbours, relatedFor, siblingsOf } from "./traverse";

/**
 * Experience Graph integrity — Phase 3 of the Living Content Platform.
 *
 * The graph is about to become the internal-linking engine, the recommendation
 * engine and the sitemap topology at once. A structural defect therefore shows up
 * in three places simultaneously, and two of them are crawler-facing — which is why
 * cycles and dangling edges are hard failures here rather than warnings.
 */

describe("Experience Graph — construction", () => {
  it("connects the two content islands that previously had no edge", () => {
    /*
     * The whole point of Phase 3. Before this, `config/seoPages.ts` and
     * `lib/content/genome` were disjoint: ~200 SEO pages linked only to each other,
     * 6 products linked only to themselves. This asserts the join exists.
     */
    // One page per platform since 2026-10-29 (the MP3 variants were merged away), so every page is checked.
    const pages = [...GRAPH.nodes.values()].filter((n) => n.kind === "seoPage");
    expect(pages.length, "no SEO pages found").toBeGreaterThan(0);
    for (const page of pages) {
      const targets = neighbours(page.id).map((n) => n.node.id);
      expect(targets, `${page.id} does not document the Download product`).toContain(productId("download"));
    }
  });

  it("derives capability edges only where the intent matches", () => {
    const video = seoPageId("tiktok-video-downloader");
    expect(GRAPH.nodes.has(video)).toBe(true);
    const targets = neighbours(video).map((n) => n.node.id);
    // A video page is about video, not about audio extraction.
    expect(targets).not.toContain(capabilityId("download", "audio-extract"));
  });

  it("files every SEO page under its platform topic", () => {
    const pages = [...GRAPH.nodes.values()].filter((n) => n.kind === "seoPage");
    /*
      One page per platform since 2026-10-29 (82 → 50 → 11: device variants merged 2026-09-02, every other variant
      2026-10-29 — see lib/seo/removed-seo-pages.ts). Every page is checked now that there are few enough.
    */
    expect(pages.length).toBe(CLUSTERS.length);

    for (const page of pages) {
      const parents = neighbours(page.id, ["partOf"]).map((n) => n.node.kind);
      expect(parents, `${page.id} has no topic`).toContain("topic");
    }
  });

  it("marks every inferred edge as derived, and every asserted one as authored", () => {
    const stats = graphStats();
    expect(stats.authored).toBeGreaterThan(0);
    expect(stats.derived).toBeGreaterThan(0);

    // Containment inside the genome is asserted by a human; SEO inference is not.
    const capPartOf = GRAPH.edges.filter(
      (e) => e.kind === "partOf" && e.from.startsWith("capability:"),
    );
    expect(capPartOf.every((e) => e.source === "authored")).toBe(true);

    const illustrates = GRAPH.edges.filter((e) => e.kind === "illustrates");
    expect(illustrates.every((e) => e.source === "derived")).toBe(true);
  });

  it("discounts derived edges below authored ones", () => {
    const authored = GRAPH.edges.find((e) => e.kind === "partOf" && e.source === "authored")!;
    const derived = GRAPH.edges.find((e) => e.kind === "partOf" && e.source === "derived")!;
    expect(derived.weight).toBeLessThan(authored.weight);
  });

  it("builds deterministically", () => {
    // An unstable graph means every rebuild reshuffles internal links — diff noise
    // and an SEO signal problem.
    const a = graphStats(buildGraph());
    const b = graphStats(buildGraph());
    expect(a).toEqual(b);
  });
});

describe("Experience Graph — integrity", () => {
  const issues = auditGraph();

  it("has no dangling edges", () => {
    const bad = issues.filter((i) => i.kind === "dangling-edge");
    expect(bad, bad.map((i) => i.detail).join("\n")).toHaveLength(0);
  });

  it("has no self-edges", () => {
    const bad = issues.filter((i) => i.kind === "self-edge");
    expect(bad, bad.map((i) => i.detail).join("\n")).toHaveLength(0);
  });

  it("keeps the containment and dependency skeleton acyclic", () => {
    // Breadcrumbs recurse and dependency resolution never terminates on a cycle.
    const bad = issues.filter((i) => i.kind === "cycle");
    expect(bad, bad.map((i) => i.detail).join("\n")).toHaveLength(0);
  });

  it("reports orphans without failing the build", () => {
    // Per RFC §4 an orphan is a content bug worth surfacing, not a build breaker.
    const orphans = issues.filter((i) => i.kind === "orphan");
    if (orphans.length) console.warn(`[graph] orphaned nodes:\n${orphans.map((o) => `  ${o.detail}`).join("\n")}`);
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("terminates ancestor walks", () => {
    const page = [...GRAPH.nodes.values()].find((n) => n.kind === "seoPage")!;
    expect(ancestors(page.id).length).toBeLessThan(16);
  });
});

describe("Experience Graph — recommendations", () => {
  it("never recommends an unbuilt product", () => {
    /*
     * The Reality Ledger applied at the link layer. `realOnly` defaults to true, so
     * a traversal cannot surface Studio, Cloud or Smart no matter how it is reached.
     */
    for (const node of GRAPH.nodes.values()) {
      for (const { node: rec } of relatedFor(node.id)) {
        expect(rec.real, `${node.id} recommends unbuilt ${rec.id}`).toBe(true);
      }
    }
  });

  it("ranks authored relations above derived ones", () => {
    const results = relatedFor(productId("download"), { limit: 20 });
    expect(results.length).toBeGreaterThan(0);
    const firstDerived = results.findIndex((r) => r.edge.source === "derived");
    const lastAuthored = results.map((r) => r.edge.source).lastIndexOf("authored");
    if (firstDerived !== -1 && lastAuthored !== -1) {
      expect(lastAuthored).toBeLessThan(firstDerived);
    }
  });

  it("derives siblings in two hops instead of storing them", () => {
    /*
     * Sibling edges are intentionally not materialized — O(n²) per cluster would
     * dominate the graph and stop it scaling (see build.ts). This pins both that
     * the relation still resolves, and that it is NOT in the edge list.
     */
    // Since 2026-10-29 each platform topic holds ONE downloader page, so a page has no same-topic sibling; the
    // relation is pinned on whichever node shares a parent with others (the campus, the support corpus, …).
    const node = [...GRAPH.nodes.values()].find((n) => siblingsOf(n.id, 5).length > 0);
    expect(node, "no node in the graph has a sibling").toBeDefined();
    const sibs = siblingsOf(node!.id, 5);
    const parents = new Set(neighbours(node!.id, ["partOf"]).map((n) => n.node.id));
    for (const s of sibs) {
      expect(s.id).not.toBe(node!.id);
      // a sibling is reached through a shared parent — two hops, never a stored edge
      expect(neighbours(s.id, ["partOf"]).some((n) => parents.has(n.node.id)), s.id).toBe(true);
    }
    expect(siblingsOf(seoPageId("tiktok-video-downloader"), 5)).toEqual([]);
    expect(GRAPH.edges.some((e) => e.kind === "sibling")).toBe(false);
  });

  it("keeps edge growth linear in the corpus", () => {
    // Guards the O(n²) regression directly: materialised sibling edges would grow with the square of the nodes.
    const stats = graphStats();
    const nodes = Object.values(stats.byNodeKind).reduce((a, b) => a + (b ?? 0), 0);
    expect(nodes).toBeGreaterThan(0);
    expect(stats.edges).toBeLessThan(nodes * 12);
  });

  it("returns a stable order across calls", () => {
    const page = [...GRAPH.nodes.values()].find((n) => n.kind === "seoPage")!;
    const a = relatedFor(page.id, { limit: 6 }).map((r) => r.node.id);
    const b = relatedFor(page.id, { limit: 6 }).map((r) => r.node.id);
    expect(a).toEqual(b);
  });

  it("honours kind and limit filters", () => {
    const page = [...GRAPH.nodes.values()].find((n) => n.kind === "seoPage")!;
    const caps = relatedFor(page.id, { kinds: ["capability"], limit: 3 });
    expect(caps.length).toBeLessThanOrEqual(3);
    expect(caps.every((c) => c.node.kind === "capability")).toBe(true);
  });

  it("resolves a topic to its pages", () => {
    const tiktok = topicId("tiktok");
    expect(GRAPH.nodes.has(tiktok)).toBe(true);
    // Pages point AT the topic, so the relation is on the inbound side.
    const inbound = GRAPH.in.get(tiktok) ?? [];
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.every((e) => e.from.startsWith("seoPage:"))).toBe(true);
  });

  it("covers the whole SEO corpus", () => {
    const stats = graphStats();
    const pageNodes = stats.byNodeKind.seoPage ?? 0;
    // exactly one page per platform (2026-10-29) — a collapse OR a doorway variant coming back both fail here
    expect(pageNodes).toBe(CLUSTERS.length);
    expect(GRAPH.nodes.has(seoPageId("tiktok-video-downloader"))).toBe(true);
  });

  it("holds only primary pages — no keyword variant is back in the graph", () => {
    /*
     * The audio variants this test used to pin (tiktok-sound-downloader, *-mp3-downloader) 301 to their platform's
     * page since 2026-10-29. What must stay true now is the opposite: no variant node at all, and none of the
     * removed URLs reachable as a page.
     */
    const pages = [...GRAPH.nodes.values()].filter((n) => n.kind === "seoPage");
    for (const page of pages) expect(page.meta?.primary, `${page.id} is not a primary page`).toBe(true);
    for (const { from } of REMOVED_SEO_PAGES) expect(GRAPH.nodes.has(seoPageId(from)), `${from} is back`).toBe(false);
  });
});
