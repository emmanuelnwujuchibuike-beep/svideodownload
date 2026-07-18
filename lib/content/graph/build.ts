/**
 * Experience Graph construction.
 *
 * Assembles one graph from every structured source the site already has:
 * the Product Genome (`lib/content/genome`) and the programmatic-SEO registry
 * (`config/seoPages.ts`). Those two have never had an edge between them; this is
 * where that link gets made.
 *
 * Pure and synchronous — it runs once at module load and the result is reused for
 * every static render. On the current corpus that is a few hundred nodes and a few
 * thousand edges, which costs well under a millisecond and never touches the
 * 2-second page budget. Phase 4 will feed authored edges in from Postgres via the
 * compile step; the shape below is what it must emit.
 */
import { GENOMES } from "@/lib/content/genome/registry";
import { isRealStage } from "@/lib/content/genome/queries";
import { getModules } from "@/lib/platform/modules";
import { PLATFORMS } from "@/lib/platforms";
import { ALL_PAGES } from "@/lib/seo/seo-pages";

import {
  DERIVED_DISCOUNT,
  EDGE_WEIGHTS,
  type EdgeKind,
  type EdgeSource,
  type ExperienceGraph,
  type GraphEdge,
  type GraphNode,
  type NodeId,
} from "./types";

/* ------------------------------- id helpers -------------------------------- */

export const productId = (id: string): NodeId => `product:${id}`;
export const capabilityId = (product: string, cap: string): NodeId => `capability:${product}.${cap}`;
export const featureId = (product: string, feat: string): NodeId => `feature:${product}.${feat}`;
export const seoPageId = (slug: string): NodeId => `seoPage:${slug}`;
export const topicId = (id: string): NodeId => `topic:${id}`;
export const workflowId = (id: string): NodeId => `workflow:${id}`;

/* ----------------------- derived capability matching ------------------------ */

/**
 * Terms that indicate an SEO page demonstrates a given capability.
 *
 * This is the one genuinely inferential step in the build, so it is kept explicit
 * and narrow rather than clever: a page whose slug or keywords contain any of these
 * terms gets an `illustrates` edge to that capability, marked `derived`. A fuzzy
 * embedding match would produce more edges and far less explainable ones — an
 * editor must be able to look at an edge and see immediately why it exists.
 */
const CAPABILITY_TERMS: Record<string, string[]> = {
  "download.audio-extract": ["mp3", "audio", "sound", "music"],
  "download.quality-select": ["hd", "1080p", "4k", "mp4", "quality"],
  "download.watermark-free": ["no-watermark", "without watermark", "watermark"],
  "download.extract": ["downloader", "download", "save"],
};

/* --------------------------------- builder --------------------------------- */

function makeEdge(from: NodeId, to: NodeId, kind: EdgeKind, source: EdgeSource): GraphEdge {
  return {
    from,
    to,
    kind,
    source,
    weight: EDGE_WEIGHTS[kind] * (source === "derived" ? DERIVED_DISCOUNT : 1),
  };
}

export function buildGraph(): ExperienceGraph {
  const nodes = new Map<NodeId, GraphNode>();
  const edges: GraphEdge[] = [];

  const addNode = (node: GraphNode) => {
    // First write wins: authored nodes are added before derived ones, so a later
    // derived pass can never downgrade a node's title or `real` flag.
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (from: NodeId, to: NodeId, kind: EdgeKind, source: EdgeSource) => {
    edges.push(makeEdge(from, to, kind, source));
  };

  /* ---- products, capabilities, features (authored, from the genome) ---- */

  for (const platform of getModules()) {
    const genome = GENOMES[platform.id];
    if (!genome) continue;

    const pid = productId(platform.id);
    addNode({
      id: pid,
      kind: "product",
      title: platform.name,
      href: platform.veracity.claimable ? platform.basePath : undefined,
      real: platform.veracity.claimable,
      meta: { stage: platform.veracity.stage, purpose: genome.purpose },
    });

    for (const cap of genome.capabilities) {
      const cid = capabilityId(platform.id, cap.id);
      addNode({
        id: cid,
        kind: "capability",
        title: cap.name,
        href: cap.provingRoute,
        real: isRealStage(cap.stage),
        meta: { stage: cap.stage },
      });
      addEdge(cid, pid, "partOf", "authored");
    }

    for (const feat of [...genome.features.core, ...genome.features.optional]) {
      const fid = featureId(platform.id, feat.id);
      addNode({
        id: fid,
        kind: "feature",
        title: feat.name,
        real: isRealStage(feat.stage),
        meta: { stage: feat.stage, essential: feat.essential },
      });
      addEdge(fid, pid, "partOf", "authored");
    }
  }

  // Product-to-product relations. Done in a second pass so both endpoints exist.
  for (const genome of Object.values(GENOMES)) {
    const pid = productId(genome.id);
    for (const dep of genome.dependencies) addEdge(pid, productId(dep), "requires", "authored");
    for (const rel of genome.related) addEdge(pid, productId(rel), "comparesTo", "authored");

    for (const wf of genome.workflows) {
      const wid = workflowId(wf.id);
      addNode({ id: wid, kind: "workflow", title: wf.title, real: true });
      // A workflow is an ordered path: consecutive steps get `nextStep` edges, and
      // each participating product is `usedIn` the workflow.
      wf.steps.forEach((step, i) => {
        addEdge(productId(step), wid, "usedIn", "authored");
        const next = wf.steps[i + 1];
        if (next) addEdge(productId(step), productId(next), "nextStep", "authored");
      });
    }
  }

  /* ---- topics (one per supported platform) ---- */

  for (const platform of Object.values(PLATFORMS)) {
    if (platform.id === "generic") continue; // not a topic anyone searches for
    addNode({
      id: topicId(platform.id),
      kind: "topic",
      title: platform.name,
      real: true,
      meta: { platformId: platform.id },
    });
  }

  /* ---- SEO pages, and the edges that finally connect them to products ---- */

  const downloadProduct = productId("download");

  for (const page of ALL_PAGES) {
    const sid = seoPageId(page.slug);
    addNode({
      id: sid,
      kind: "seoPage",
      title: page.title,
      href: `/${page.slug}`,
      real: true,
      meta: { clusterId: page.clusterId, platformId: page.platformId, primary: page.isPrimary },
    });

    // Every downloader page documents the Download product — that is what the page
    // is FOR, and it is the edge neither system could previously express.
    addEdge(sid, downloadProduct, "documents", "derived");

    // …and sits under its platform topic.
    const topic = topicId(page.platformId);
    if (nodes.has(topic)) addEdge(sid, topic, "partOf", "derived");

    // …and illustrates whichever capabilities its intent matches.
    const haystack = `${page.slug} ${page.primaryKeyword} ${page.secondaryKeywords.join(" ")}`.toLowerCase();
    for (const [capKey, terms] of Object.entries(CAPABILITY_TERMS)) {
      const [product, cap] = capKey.split(".");
      const cid = capabilityId(product!, cap!);
      if (!nodes.has(cid)) continue;
      if (terms.some((t) => haystack.includes(t))) addEdge(sid, cid, "illustrates", "derived");
    }
  }

  /*
   * NOTE — sibling edges are deliberately NOT materialized.
   *
   * The obvious implementation links every page in a cluster to every other, which
   * is O(n²) per cluster: at today's 148 pages that is ~1,600 edges (two thirds of
   * the whole graph), and at 1,000 pages it becomes ~83,000 — all to express a fact
   * already implied by two `partOf` edges pointing at the same topic.
   *
   * `siblingsOf()` in traverse.ts derives them on demand in two hops instead, so
   * storage stays linear in the corpus. Materializing a symmetric, fully-connected
   * relation is the single easiest way to make a content graph stop scaling.
   */

  /* ---- adjacency ---- */

  const out = new Map<NodeId, GraphEdge[]>();
  const inn = new Map<NodeId, GraphEdge[]>();
  for (const edge of edges) {
    (out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)!).push(edge);
    (inn.get(edge.to) ?? inn.set(edge.to, []).get(edge.to)!).push(edge);
  }

  return { nodes, edges, out, in: inn };
}

/** The graph, built once per process. */
export const GRAPH: ExperienceGraph = buildGraph();
