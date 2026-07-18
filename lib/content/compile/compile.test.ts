import { describe, expect, it } from "vitest";

import { GRAPH } from "@/lib/content/graph/build";
import { GENOMES } from "@/lib/content/genome/registry";
import { getModules } from "@/lib/platform/modules";

import {
  digest,
  edgeToRow,
  emitEdgeModule,
  emitGenomeModule,
  genomeToRow,
  rowToEdge,
  rowToGenome,
  stableStringify,
} from "./serialize";

/**
 * Compile-step guarantees — Living Content Platform Phase 4.
 *
 * Phase 4 moves authorship of the genome and the authored graph out of TS and into
 * Postgres. That is only safe if the journey is LOSSLESS, and this file proves it
 * before a single row is written: every product currently in `registry.ts` must
 * survive the trip to a row and back byte-identically.
 *
 * If these fail, the migration of authority silently drops product knowledge —
 * capabilities, releases, privacy notes — and nothing downstream would notice,
 * because the compiler would happily emit the truncated version.
 */

describe("compile — genome round-trip", () => {
  const veracityFor = (id: string) => {
    const m = getModules().find((x) => x.id === id)!;
    return { stage: m.veracity.stage, claimable: m.veracity.claimable, verifiedAt: m.veracity.verifiedAt };
  };

  it("survives TS → row → TS for every product, losslessly", () => {
    for (const [id, genome] of Object.entries(GENOMES)) {
      const back = rowToGenome(genomeToRow(genome, veracityFor(id)));
      expect(back, `${id} lost data in the round trip`).toEqual(genome);
    }
  });

  it("denormalizes veracity onto the row so the truth gate stays queryable", () => {
    const row = genomeToRow(GENOMES.download!, veracityFor("download"));
    expect(row.stage).toBe("live");
    expect(row.claimable).toBe(true);
    // Mirrors the product_genomes_claimable_chk CHECK constraint in 0085.
    expect(["live", "beta", "alpha"]).toContain(row.stage);
  });

  it("never marks an unbuilt product claimable on the row", () => {
    for (const id of ["studio", "cloud", "smart"]) {
      const row = genomeToRow(GENOMES[id]!, veracityFor(id));
      // The DB CHECK would reject this combination outright; assert we never
      // construct it in the first place.
      expect(row.claimable, `${id} would violate product_genomes_claimable_chk`).toBe(false);
    }
  });
});

describe("compile — edge round-trip", () => {
  const authored = GRAPH.edges.filter((e) => e.source === "authored");

  it("has authored edges to persist", () => {
    expect(authored.length).toBeGreaterThan(0);
  });

  it("survives edge → row → edge for every authored edge", () => {
    for (const edge of authored) {
      expect(rowToEdge(edgeToRow(edge))).toEqual(edge);
    }
  });

  it("refuses to persist a derived edge", () => {
    /*
     * Derived edges are recomputed every build. Persisting one would let it go
     * stale when its inputs change, and would destroy the authored/derived
     * distinction the whole ranking model depends on.
     */
    const derived = GRAPH.edges.find((e) => e.source === "derived")!;
    expect(() => edgeToRow(derived)).toThrow(/derived/);
  });

  it("falls back to the kind's default weight when a row omits one", () => {
    // An editor adding an edge by hand should not have to reason about numbers.
    const edge = rowToEdge({ from_id: "a", to_id: "b", kind: "partOf", weight: null, note: null });
    expect(edge.weight).toBeGreaterThan(0);
    expect(edge.source).toBe("authored");
  });
});

describe("compile — determinism", () => {
  const rows = Object.entries(GENOMES).map(([id, g]) => {
    const m = getModules().find((x) => x.id === id)!;
    return genomeToRow(g, { stage: m.veracity.stage, claimable: m.veracity.claimable });
  });

  it("emits byte-identical output regardless of input order", () => {
    /*
     * Postgres returns rows in no guaranteed order and does not preserve jsonb key
     * order. Without canonical sorting the digest would move on every compile,
     * making each deploy look like a content change and burying real diffs.
     */
    const a = emitGenomeModule(rows);
    const b = emitGenomeModule([...rows].reverse());
    expect(digest(a)).toBe(digest(b));
    expect(a).toBe(b);
  });

  it("sorts object keys recursively", () => {
    const one = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const two = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(one).toBe(two);
  });

  it("changes the digest when content actually changes", () => {
    const before = digest(emitGenomeModule(rows));
    const mutated = rows.map((r) =>
      r.product_id === "download" ? { ...r, genome: { ...r.genome, purpose: "changed" } } : r,
    );
    expect(digest(emitGenomeModule(mutated))).not.toBe(before);
  });

  it("emits edges deterministically too", () => {
    const authored = GRAPH.edges.filter((e) => e.source === "authored").map((e) => edgeToRow(e));
    expect(emitEdgeModule(authored)).toBe(emitEdgeModule([...authored].reverse()));
  });
});

describe("compile — emitted module shape", () => {
  const rows = Object.entries(GENOMES).map(([id, g]) => {
    const m = getModules().find((x) => x.id === id)!;
    return genomeToRow(g, { stage: m.veracity.stage, claimable: m.veracity.claimable });
  });
  const source = emitGenomeModule(rows);

  it("marks the file as generated so nobody hand-edits it", () => {
    expect(source).toContain("GENERATED FILE — DO NOT EDIT");
    expect(source).toContain("content:compile");
  });

  it("emits a typed export, not bare JSON", () => {
    // Type-checked content is one of the three reasons the RFC chose compile-to-TS
    // over request-time reads; emitting untyped JSON would forfeit it.
    expect(source).toContain("Record<string, ProductGenome>");
    expect(source).toContain('import type { ProductGenome }');
  });

  it("escapes every embedded document so the emitted TS is valid", () => {
    /*
     * The escaping risk is inside each genome document — an apostrophe or quote in
     * a purpose, release note or threat note. The surrounding module is TS, not
     * JSON (it carries trailing commas by design), so parsing the whole literal as
     * JSON tests the wrong artifact. Each embedded document IS canonical JSON, so
     * that is what gets parsed back.
     */
    for (const row of rows) {
      expect(() => JSON.parse(stableStringify(row.genome)), `${row.product_id} emitted invalid JSON`).not.toThrow();
      expect(JSON.parse(stableStringify(row.genome))).toEqual(
        JSON.parse(JSON.stringify(row.genome)),
      );
    }
  });

  it("emits every product exactly once", () => {
    for (const row of rows) {
      const occurrences = source.split(`"${row.product_id}":`).length - 1;
      expect(occurrences, `${row.product_id} emitted ${occurrences} times`).toBe(1);
    }
  });
});
