/**
 * The compile step — Living Content Platform Phase 4 (RFC §1).
 *
 * Turns authored rows in the authoring plane (Postgres, migration 0085) into the
 * typed TS modules the render plane statically compiles. Publishing is a build, not
 * a write.
 *
 * ── Why this file is pure ──────────────────────────────────────────────────────
 *
 * Every function here is a total, side-effect-free transformation. The Supabase I/O
 * lives in `scripts/content-compile.mjs`, which is a thin shell around these. That
 * split is what makes the round-trip property testable WITHOUT a database:
 *
 *     rowToGenome(genomeToRow(g)) === g       for every g in the registry
 *
 * That equality is the whole safety argument for Phase 4. Moving authorship of the
 * genome from `registry.ts` into Postgres is only safe if the journey is lossless,
 * and a test can prove it before a single row is ever written. If it fails, the
 * migration of authority silently drops product knowledge.
 */
import type { ProductGenome } from "@/lib/content/genome/types";
import type { EdgeKind, EdgeSource, GraphEdge } from "@/lib/content/graph/types";
import { EDGE_WEIGHTS } from "@/lib/content/graph/types";

/* ------------------------------- genome rows -------------------------------- */

/** A `product_genomes` row. Mirrors migration 0085 exactly. */
export interface GenomeRow {
  product_id: string;
  genome: ProductGenome;
  /** Denormalized out of the document so the truth gate is queryable. */
  stage: string;
  claimable: boolean;
  verified_at: string | null;
}

export interface VeracityInput {
  stage: string;
  claimable: boolean;
  verifiedAt?: string;
}

export function genomeToRow(genome: ProductGenome, veracity: VeracityInput): GenomeRow {
  return {
    product_id: genome.id,
    genome,
    stage: veracity.stage,
    claimable: veracity.claimable,
    verified_at: veracity.verifiedAt ?? null,
  };
}

export function rowToGenome(row: GenomeRow): ProductGenome {
  // The document is authoritative for shape; the denormalized columns exist only
  // for indexing and the DB-level CHECK. Reading them back would let a divergent
  // column silently rewrite the genome.
  return row.genome;
}

/* -------------------------------- edge rows --------------------------------- */

/** A `graph_edges` row. Only AUTHORED edges are ever persisted (see 0085). */
export interface EdgeRow {
  from_id: string;
  to_id: string;
  kind: string;
  weight: number | null;
  note: string | null;
}

export function edgeToRow(edge: GraphEdge, note?: string): EdgeRow {
  if (edge.source !== "authored") {
    // Derived edges are recomputed every build and must never be stored — once
    // persisted they go stale, and the authored/derived distinction is lost.
    throw new Error(`refusing to persist a derived edge: ${edge.from} → ${edge.to}`);
  }
  return {
    from_id: edge.from,
    to_id: edge.to,
    kind: edge.kind,
    weight: edge.weight,
    note: note ?? null,
  };
}

export function rowToEdge(row: EdgeRow): GraphEdge {
  const kind = row.kind as EdgeKind;
  return {
    from: row.from_id,
    to: row.to_id,
    kind,
    // A null weight falls back to the kind's default, so an editor adding an edge
    // by hand never has to reason about numbers to get sane ranking.
    weight: row.weight ?? EDGE_WEIGHTS[kind] ?? 1,
    source: "authored" satisfies EdgeSource,
  };
}

/* ------------------------------ deterministic IO ----------------------------- */

/**
 * JSON with recursively sorted keys.
 *
 * The compiler's output digest is compared run-to-run to detect non-determinism
 * (`compile_runs.digest`). Postgres does not preserve jsonb key order, so encoding
 * a document the way it happens to come back would make every compile a spurious
 * diff and every deploy a content change. Sorting makes the emission canonical.
 */
export function stableStringify(value: unknown, indent = 2): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}

/** FNV-1a over the emitted text. Cheap, stable, and adequate for change detection. */
export function digest(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* --------------------------------- emission ---------------------------------- */

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted by \`npm run content:compile\` from the authoring plane (migration 0085).
 * Edits here are overwritten on the next compile; change the content in the admin
 * authoring tables instead.
 *
 * This file exists so marketing pages cost 0ms at request time: the render plane
 * reads typed TS, never Postgres. See docs/LIVING_CONTENT_PLATFORM_RFC.md §1.
 */`;

/**
 * Emit the generated genome module.
 *
 * Products are sorted by id so the output is byte-stable regardless of the order
 * rows come back from Postgres — otherwise the digest moves on every compile.
 */
export function emitGenomeModule(rows: GenomeRow[]): string {
  const sorted = [...rows].sort((a, b) => a.product_id.localeCompare(b.product_id));
  const body = sorted
    .map((row) => `  ${JSON.stringify(row.product_id)}: ${stableStringify(row.genome, 2)},`)
    .join("\n");

  return `${BANNER}
import type { ProductGenome } from "@/lib/content/genome/types";

export const GENERATED_GENOMES: Record<string, ProductGenome> = {
${body}
};
`;
}

/** Emit the generated authored-edge module. */
export function emitEdgeModule(rows: EdgeRow[]): string {
  const sorted = [...rows].sort(
    (a, b) => a.from_id.localeCompare(b.from_id) || a.to_id.localeCompare(b.to_id) || a.kind.localeCompare(b.kind),
  );
  return `${BANNER}
import type { GraphEdge } from "@/lib/content/graph/types";

export const AUTHORED_EDGES: GraphEdge[] = ${stableStringify(sorted.map(rowToEdge), 2)};
`;
}
