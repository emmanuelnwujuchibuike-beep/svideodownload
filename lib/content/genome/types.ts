/**
 * Product Genome™ — the authoritative structured description of every Frenzsave
 * product. Phase 2 of the Living Content Platform (docs/LIVING_CONTENT_PLATFORM_RFC.md §2).
 *
 * ── Two refinements on the RFC sketch, both deliberate ──────────────────────────
 *
 * 1. The genome is a SEPARATE record keyed by module id, not extra fields bolted
 *    onto `PlatformModule`. `modules.ts` is imported by client components (nav, app
 *    launcher, RBAC gates). Hanging ~30 fields of marketing prose, release history
 *    and structured data off it would ship all of that into the client bundle of
 *    every signed-in page — on a project with a 2-second cold-entry budget. The
 *    module registry stays the small nav/RBAC contract; the genome is imported only
 *    by marketing and server surfaces that actually need it.
 *
 * 2. The genome is JSON-SERIALIZABLE — no `LucideIcon`, no functions, unlike the
 *    RFC's first sketch. That is what makes Phase 4 possible: the authoring plane
 *    compiles Postgres rows into exactly this shape. A genome containing a JS value
 *    could never round-trip through a database. Icons stay on `PlatformModule`,
 *    where they are a rendering concern.
 *
 * Every claim in a genome is subject to the Reality Ledger — see
 * `lib/content/reality-ledger.ts`. Populate honestly: an unbuilt product gets sparse
 * fields, not invented ones. Sparse is information; fabricated is a liability.
 */

/* ------------------------------- shared scalars ------------------------------ */

/** Build maturity. Mirrors `ProductVeracity["stage"]` and must agree with it. */
export type Stage = "live" | "beta" | "alpha" | "internal" | "planned" | "concept";

/** Surfaces a product can run on. */
export type SurfaceKind = "web" | "pwa" | "android" | "ios" | "extension" | "api";

/** A pointer to a content node. Resolved by the Experience Graph in Phase 3. */
export interface ContentRef {
  /** Stable slug of the target content item. */
  id: string;
  title: string;
  /** Route, when the content is already published. Absent ⇒ planned. */
  href?: string;
  stage: Stage;
}

/* ---------------------------------- pieces ---------------------------------- */

export interface Capability {
  id: string;
  name: string;
  description: string;
  /**
   * Per-capability stage. A `live` product can contain a `planned` capability —
   * without this the ledger leaks at the feature-card level, which is precisely
   * where it leaked before (feature cards describing unbuilt behaviour).
   */
  stage: Stage;
  /** Route or API path that demonstrates it. */
  provingRoute?: string;
}

export interface FeatureRef {
  id: string;
  name: string;
  stage: Stage;
  /** Whether this is required to use the product at all. */
  essential: boolean;
}

export interface Integration {
  name: string;
  kind: "storage" | "payments" | "email" | "media" | "auth" | "analytics" | "push" | "other";
  /** Whether the integration is wired up today. */
  active: boolean;
  notes?: string;
}

export interface SurfaceSupport {
  kind: SurfaceKind;
  stage: Stage;
  notes?: string;
}

export interface PermissionRef {
  /** e.g. "browser.notifications", "billing.pro". */
  id: string;
  reason: string;
  required: boolean;
}

export interface Release {
  version: string;
  /** ISO date. */
  date: string;
  changes: string[];
  breaking: boolean;
  /** Commit or migration that carried it. */
  evidence?: string;
}

export interface CompatRange {
  /** What the range applies to, e.g. "iOS Safari", "migration". */
  subject: string;
  min: string;
  max?: string;
  notes?: string;
}

export interface PerfSample {
  /** ISO date the sample was taken. */
  measuredAt: string;
  lcpMs?: number;
  /** Main-thread blocking on the documented throttled profile. */
  blockingMs?: number;
  notes?: string;
}

export interface MetricDef {
  id: string;
  name: string;
  description: string;
  /** Whether this metric is actually collected today. */
  collected: boolean;
}

export interface JsonLdBlock {
  /** schema.org type, e.g. "SoftwareApplication". */
  type: string;
  /** Emitted as-is into the page `@graph`. Must stay JSON-serializable. */
  data: Record<string, unknown>;
}

export interface RoadmapRef {
  id: string;
  title: string;
  /** Deliberately coarse — a date we cannot keep is a claim we shouldn't make. */
  horizon: "next" | "later" | "exploring";
}

export interface WorkflowRef {
  id: string;
  title: string;
  /** Ordered product ids a user passes through. */
  steps: string[];
}

/* --------------------------------- the genome -------------------------------- */

export interface ProductGenome {
  /** Must match a `PlatformModule.id` in `lib/platform/modules.ts`. */
  id: string;

  /** Why this exists, in one sentence, for humans and for AI summarisation. */
  purpose: string;

  capabilities: Capability[];
  features: { core: FeatureRef[]; optional: FeatureRef[] };

  /** Genome ids this product needs in order to function. */
  dependencies: string[];
  integrations: Integration[];
  surfaces: SurfaceSupport[];
  permissions: PermissionRef[];

  learning: { tutorials: ContentRef[]; academy: ContentRef[]; faqs: ContentRef[] };
  developer: { apiRefs: ContentRef[]; guides: ContentRef[] };

  releases: Release[];
  compatibility: CompatRange[];

  accessibility: { wcagLevel: "A" | "AA" | "AAA"; audited?: string; notes: string[] };
  privacy: { dataCollected: string[]; retention: string; policyAnchor: string };
  security: { authRequired: boolean; rlsPolicies: string[]; threatNotes: string[] };
  performance: { budgetMs: number; lcpTargetMs: number; measured?: PerfSample };

  analytics: MetricDef[];
  seo: { title: string; description: string; keywords: string[]; canonical: string };
  structuredData: JsonLdBlock[];

  /** Genome ids that pair naturally with this one. */
  related: string[];
  workflows: WorkflowRef[];
  roadmap: RoadmapRef[];
}
