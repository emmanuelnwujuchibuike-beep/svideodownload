/**
 * Product Genome queries — the read API for every surface that needs structured
 * product knowledge (marketing pages, JSON-LD emission, the Experience Graph in
 * Phase 3, and the content compiler in Phase 4).
 *
 * Pure functions over static data: no I/O, no async, safe to call during a static
 * render. That is what lets marketing pages consume the genome without spending any
 * of the 2-second page budget.
 */
import { getModule, getModules } from "@/lib/platform/modules";
import type { PlatformModule } from "@/lib/platform/module-registry";

import { GENOMES } from "./registry";
import type { Capability, ProductGenome, Stage } from "./types";

/** Stages at which a thing genuinely exists and may be described in present tense. */
const REAL_STAGES: readonly Stage[] = ["live", "beta", "alpha"];

export function isRealStage(stage: Stage): boolean {
  return REAL_STAGES.includes(stage);
}

/* --------------------------------- lookups ---------------------------------- */

export function getGenome(id: string): ProductGenome | undefined {
  return GENOMES[id];
}

export function getGenomes(): ProductGenome[] {
  // Declaration order of MODULES, so every surface renders products consistently.
  return getModules()
    .map((m) => GENOMES[m.id])
    .filter((g): g is ProductGenome => Boolean(g));
}

/**
 * A genome joined to its module — the shape marketing surfaces actually want,
 * since they need the icon and accent (module) alongside the knowledge (genome).
 */
export interface ProductProfile {
  /** Named `platform`, not `module` — `module` is a reserved binding under
   *  @next/next/no-assign-module-variable and fails the production build. */
  platform: PlatformModule;
  genome: ProductGenome;
}

export function getProfile(id: string): ProductProfile | undefined {
  const platform = getModule(id);
  const genome = GENOMES[id];
  return platform && genome ? { platform, genome } : undefined;
}

export function getProfiles(): ProductProfile[] {
  return getModules()
    .map((platform) => ({ platform, genome: GENOMES[platform.id] }))
    .filter((p): p is ProductProfile => Boolean(p.genome));
}

/* ------------------------------ ledger-aware reads ---------------------------- */

/**
 * Products a marketing surface may present as existing.
 *
 * THIS is the function landing-page sections should call — not `getModules()`.
 * The mockup for the redesigned landing page shows six product cards including
 * Studio, Cloud and an "AI" product, each with a live "Explore" link. Three of
 * those do not exist. Rendering from this function makes that class of mistake
 * structurally impossible rather than a thing reviewers must catch.
 */
export function getClaimableProfiles(): ProductProfile[] {
  return getProfiles().filter((p) => p.platform.veracity.claimable);
}

/** Capabilities of a product that genuinely exist today. */
export function realCapabilities(id: string): Capability[] {
  return getGenome(id)?.capabilities.filter((c) => isRealStage(c.stage)) ?? [];
}

/** Every capability across the ecosystem that exists today. */
export function allRealCapabilities(): { productId: string; capability: Capability }[] {
  return getGenomes().flatMap((g) =>
    g.capabilities.filter((c) => isRealStage(c.stage)).map((capability) => ({ productId: g.id, capability })),
  );
}

/* --------------------------------- integrity --------------------------------- */

export interface GenomeIssue {
  productId: string;
  field: string;
  problem: string;
}

/**
 * Structural problems between the genome and the module registry.
 *
 * Returned as data rather than thrown so both the test suite and a future admin
 * "content quality" panel (RFC Phase 4) can consume the same check.
 */
export function auditGenomes(): GenomeIssue[] {
  const issues: GenomeIssue[] = [];
  const modules = getModules();

  for (const platform of modules) {
    const genome = GENOMES[platform.id];
    if (!genome) {
      issues.push({ productId: platform.id, field: "genome", problem: "module has no genome record" });
      continue;
    }

    // The two registries must agree about whether a product is real. Disagreement
    // is exactly how "Smart" ended up marked beta with nothing mounted.
    const moduleReal = isRealStage(platform.veracity.stage);
    const hasRealCapability = genome.capabilities.some((c) => isRealStage(c.stage));
    if (!moduleReal && hasRealCapability) {
      issues.push({
        productId: platform.id,
        field: "capabilities",
        problem: `module stage is "${platform.veracity.stage}" but a capability claims to be real`,
      });
    }

    // An unclaimable product must not carry marketing surface area.
    if (!platform.veracity.claimable && genome.learning.tutorials.some((t) => isRealStage(t.stage))) {
      issues.push({
        productId: platform.id,
        field: "learning.tutorials",
        problem: "unclaimable product publishes a live tutorial",
      });
    }

    // Dependencies and relations must resolve, or the Experience Graph will have
    // dangling edges the moment Phase 3 traverses this.
    for (const dep of genome.dependencies) {
      if (!GENOMES[dep]) {
        issues.push({ productId: platform.id, field: "dependencies", problem: `unknown product "${dep}"` });
      }
    }
    for (const rel of genome.related) {
      if (!GENOMES[rel]) {
        issues.push({ productId: platform.id, field: "related", problem: `unknown product "${rel}"` });
      }
    }
    for (const wf of genome.workflows) {
      for (const step of wf.steps) {
        if (!GENOMES[step]) {
          issues.push({ productId: platform.id, field: `workflows.${wf.id}`, problem: `unknown step "${step}"` });
        }
      }
    }
  }

  // Orphan genomes: a record with no module is unreachable and will silently rot.
  for (const id of Object.keys(GENOMES)) {
    if (!modules.some((m) => m.id === id)) {
      issues.push({ productId: id, field: "genome", problem: "genome has no matching module" });
    }
  }

  return issues;
}

/* ------------------------------- structured data ------------------------------ */

/**
 * schema.org `@graph` nodes for the claimable products.
 *
 * Emitting entities from the same source that drives the copy is what builds the
 * entity authority the SEO brief asks for: the machine-readable description and the
 * human-readable one cannot drift, because they are the same record.
 */
export function productJsonLd(siteUrl: string): Record<string, unknown>[] {
  return getClaimableProfiles().map(({ platform, genome }) => ({
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}${platform.basePath}#product`,
    name: platform.name,
    description: genome.purpose,
    url: `${siteUrl}${platform.basePath}`,
    applicationCategory:
      (genome.structuredData[0]?.data.applicationCategory as string | undefined) ?? "WebApplication",
    operatingSystem: genome.surfaces.filter((s) => isRealStage(s.stage)).map((s) => s.kind).join(", "),
    featureList: genome.capabilities.filter((c) => isRealStage(c.stage)).map((c) => c.name),
  }));
}
