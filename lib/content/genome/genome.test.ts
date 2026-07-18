import { describe, expect, it } from "vitest";

import {
  allRealCapabilities,
  auditGenomes,
  getClaimableProfiles,
  getGenome,
  getGenomes,
  getProfiles,
  isRealStage,
  productJsonLd,
  realCapabilities,
} from "./queries";
import { GENOMES } from "./registry";
import { getModules } from "@/lib/platform/modules";

/**
 * Product Genome integrity — Phase 2 of the Living Content Platform.
 *
 * The genome is about to become the source that drives marketing copy, JSON-LD,
 * the Experience Graph and generated content. A wrong genome therefore propagates
 * everywhere at once, which makes these checks load-bearing rather than routine.
 *
 * The specific failure being defended against: the redesigned landing mockup shows
 * six product cards — including Studio, Cloud and an "AI" product — each with a live
 * "Explore" link. Three of those do not exist. If the genome is populated from the
 * mockup instead of from the codebase, the Reality Ledger's own source of truth
 * becomes the thing telling the lie, and every downstream gate inherits it.
 */

describe("Product Genome — registry integrity", () => {
  it("has a genome for every module, and no orphans", () => {
    const moduleIds = getModules().map((m) => m.id).sort();
    expect(Object.keys(GENOMES).sort()).toEqual(moduleIds);
  });

  it("reports no structural issues", () => {
    const issues = auditGenomes();
    const report = issues.map((i) => `  ${i.productId}.${i.field}: ${i.problem}`).join("\n");
    expect(issues, `Genome audit failed:\n${report}`).toHaveLength(0);
  });

  it("keeps every genome id in sync with its own key", () => {
    for (const [key, genome] of Object.entries(GENOMES)) {
      expect(genome.id, `GENOMES["${key}"] declares id "${genome.id}"`).toBe(key);
    }
  });

  it("gives every product a purpose", () => {
    for (const g of getGenomes()) {
      expect(g.purpose.length, `${g.id} has no purpose`).toBeGreaterThan(10);
    }
  });
});

describe("Product Genome — the honesty invariants", () => {
  it("keeps unbuilt products free of real capabilities", () => {
    // Sparse is the correct state for studio/cloud. If someone enriches them from
    // the marketing mockup, this fails — which is the entire point.
    for (const id of ["studio", "cloud"]) {
      expect(realCapabilities(id), `${id} claims a real capability but is not built`).toHaveLength(0);
    }
  });

  it("exposes only claimable products to marketing surfaces", () => {
    const ids = getClaimableProfiles().map((p) => p.platform.id).sort();
    expect(ids).toEqual(["community", "download"]);
  });

  it("never emits JSON-LD for an unbuilt product", () => {
    const names = productJsonLd("https://frenzsave.com").map((n) => n.name);
    expect(names).not.toContain("Frenz Studio");
    expect(names).not.toContain("Frenz Cloud");
    expect(names).toContain("Frenz Download");
  });

  it("emits only real surfaces and capabilities into structured data", () => {
    const node = productJsonLd("https://frenzsave.com").find((n) => n.name === "Frenz Download");
    // `extension`, `android` and `ios` are all `concept` for download today.
    expect(node?.operatingSystem).not.toContain("ios");
    expect(node?.featureList).toContain("Link extraction");
  });

  it("holds the 'Smart' brand rule — no product is named with 'AI'", () => {
    // The mockup labels this product "Frenzsave AI". The established rule is that
    // the suite is "Smart"; see the comment on the module entry in modules.ts.
    for (const m of getModules()) {
      expect(m.name, `${m.id} is named with "AI"`).not.toMatch(/\bAI\b/);
    }
  });

  it("never encodes status as prose in `purpose`", () => {
    /*
     * Status belongs in `veracity.stage` — a queryable field the badge, the ledger
     * and the compiler all read. Encoding it in the sentence ("Planned: …",
     * "Internal: …") makes it invisible to every one of them AND leaks engineering
     * register onto marketing surfaces: the product grid rendered "Internal:
     * assistant endpoint backing…" to visitors before this was caught.
     */
    for (const g of getGenomes()) {
      expect(g.purpose, `${g.id}.purpose encodes status as prose`).not.toMatch(
        /^\s*(?:planned|internal|coming soon|upcoming|concept|todo)\s*[:—-]/i,
      );
    }
  });

  it("agrees with the module registry about what is real", () => {
    for (const m of getModules()) {
      const g = getGenome(m.id)!;
      if (!isRealStage(m.veracity.stage)) {
        expect(
          g.capabilities.every((c) => !isRealStage(c.stage)),
          `${m.id} is ${m.veracity.stage} but has a real capability`,
        ).toBe(true);
      }
    }
  });
});

describe("Product Genome — query surface", () => {
  it("joins every module to its genome", () => {
    expect(getProfiles()).toHaveLength(getModules().length);
  });

  it("returns products in module declaration order", () => {
    expect(getGenomes().map((g) => g.id)).toEqual(getModules().map((m) => m.id));
  });

  it("collects real capabilities across the ecosystem", () => {
    const real = allRealCapabilities();
    expect(real.length).toBeGreaterThan(5);
    expect(real.every(({ capability }) => isRealStage(capability.stage))).toBe(true);
  });

  it("resolves dependencies and workflow steps to real products", () => {
    for (const g of getGenomes()) {
      for (const dep of g.dependencies) expect(getGenome(dep), `${g.id} → ${dep}`).toBeDefined();
      for (const wf of g.workflows) {
        for (const step of wf.steps) expect(getGenome(step), `${g.id}.${wf.id} → ${step}`).toBeDefined();
      }
    }
  });
});
