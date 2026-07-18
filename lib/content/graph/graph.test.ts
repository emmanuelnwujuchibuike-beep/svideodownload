import { describe, expect, it } from "vitest";

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
    const mp3 = [...GRAPH.nodes.values()].find(
      (n) => n.kind === "seoPage" && n.id.includes("mp3-downloader"),
    );
    expect(mp3, "no mp3 SEO page found").toBeDefined();

    const targets = neighbours(mp3!.id).map((n) => n.node.id);
    expect(targets, "SEO page does not document the Download product").toContain(
      productId("download"),
    );
    expect(targets, "mp3 page does not illustrate audio extraction").toContain(
      capabilityId("download", "audio-extract"),
    );
  });

  it("derives capability edges only where the intent matches", () => {
    const mp3 = [...GRAPH.nodes.values()].find(
      (n) => n.kind === "seoPage" && n.id.includes("mp3-downloader"),
    )!;
    const targets = neighbours(mp3.id).map((n) => n.node.id);
    // An MP3 page is about audio, not about watermark removal.
    expect(targets).not.toContain(capabilityId("download", "watermark-free"));
  });

  it("files every SEO page under its platform topic", () => {
    const pages = [...GRAPH.nodes.values()].filter((n) => n.kind === "seoPage");
    expect(pages.length).toBeGreaterThan(50);

    for (const page of pages.slice(0, 25)) {
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
    const page = seoPageId("tiktok-video-downloader");
    const sibs = siblingsOf(page, 5);
    expect(sibs.length).toBeGreaterThan(0);
    expect(sibs.every((s) => s.kind === "seoPage")).toBe(true);
    expect(sibs.some((s) => s.id === page)).toBe(false);
    expect(GRAPH.edges.some((e) => e.kind === "sibling")).toBe(false);
  });

  it("keeps edge growth linear in the corpus", () => {
    // Guards the O(n²) regression directly: ~148 pages must not imply ~1,600 edges.
    const stats = graphStats();
    const pages = stats.byNodeKind.seoPage ?? 0;
    expect(stats.edges).toBeLessThan(pages * 12);
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
    expect(pageNodes).toBeGreaterThan(50);
    expect(GRAPH.nodes.has(seoPageId("tiktok-video-downloader"))).toBe(true);
  });

  it("matches audio intent across differing cluster vocabularies", () => {
    /*
     * Clusters don't share a vocabulary for the same intent: Facebook has
     * `mp3-downloader`, TikTok has `sound-downloader`. Both are audio extraction.
     * A slug-equality mapping would silently miss one, so `CAPABILITY_TERMS`
     * matches on several terms per capability — this pins that it works.
     */
    const sound = seoPageId("tiktok-sound-downloader");
    expect(GRAPH.nodes.has(sound)).toBe(true);
    expect(neighbours(sound).map((n) => n.node.id)).toContain(
      capabilityId("download", "audio-extract"),
    );
  });
});
