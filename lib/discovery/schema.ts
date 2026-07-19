import { SITE_URL } from "@/lib/site";

import { getEntity, type Entity } from "./entities";

/**
 * Schema Registry — Discovery Platform Phase 2.
 * See `docs/DISCOVERY_PLATFORM_RFC.md` §7.
 *
 * One JSON-LD emitter per entity kind, all gated on veracity.
 *
 * ── Why a registry instead of per-page assembly ───────────────────────────────
 *
 * Structured data was previously hand-assembled at each call site, which meant the
 * machine-readable description and the human-readable copy were two independent
 * pieces of writing that drifted. Emitting from the entity — the same record that
 * renders the page — makes drift impossible by construction. That is the real
 * reason to generate rather than hand-write; brevity is incidental.
 *
 * ── The veracity gate ─────────────────────────────────────────────────────────
 *
 * `emit()` returns null for anything that is not real. This is stricter than it
 * looks, and deliberately so: structured data is a machine-readable ASSERTION OF
 * FACT. A `Course` for a school teaching an unbuilt product, or a
 * `SoftwareApplication` for a concept-stage product, teaches Google and every AI
 * crawler a false entity — and that damage propagates into third-party knowledge
 * bases and outlives the fix. A wrong sentence can be edited; a wrong entity has
 * to be un-learned.
 *
 * `productJsonLd()` in lib/content/genome/queries.ts already applies this rule to
 * products. This generalises it to every kind.
 *
 * ── Output discipline ─────────────────────────────────────────────────────────
 *
 * Everything here returns plain objects. Serialisation is the caller's job, and it
 * must go through `jsonLd()` in lib/seo/json-ld.ts — never raw `JSON.stringify`.
 * Four raw blocks were a stored-XSS vector when the underlying data became
 * admin-authored, and Academy and Discovery content is admin-authored by design.
 */

export type JsonLdObject = Record<string, unknown>;

const ORGANIZATION = {
  "@type": "Organization",
  name: "Frenzsave",
  url: SITE_URL,
} as const;

/* --------------------------------- emitters ---------------------------------- */

type Emitter = (entity: Entity) => JsonLdObject | null;

const EMITTERS: Partial<Record<Entity["kind"], Emitter>> = {
  product: (e) => ({
    "@type": "SoftwareApplication",
    name: e.title,
    url: e.canonical,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    publisher: ORGANIZATION,
  }),

  lesson: (e) => ({
    "@type": "LearningResource",
    name: e.title,
    url: e.canonical,
    provider: ORGANIZATION,
    /*
      `timeRequired` is an ISO 8601 duration. Emitted only when we genuinely have
      a reading time — an invented duration is a small lie that a rich result
      would display as fact.
    */
    ...(typeof e.meta.minutes === "number"
      ? { timeRequired: `PT${e.meta.minutes}M` }
      : {}),
    ...(typeof e.meta.topic === "string" ? { about: e.meta.topic } : {}),
  }),

  guide: (e) => ({
    "@type": "Course",
    name: e.title,
    url: e.canonical,
    provider: ORGANIZATION,
  }),

  seoPage: (e) => ({
    "@type": "WebPage",
    name: e.title,
    url: e.canonical,
    publisher: ORGANIZATION,
  }),

  help: (e) => ({
    "@type": "Article",
    headline: e.title,
    url: e.canonical,
    publisher: ORGANIZATION,
  }),

  apiRef: (e) => ({
    "@type": "TechArticle",
    headline: e.title,
    url: e.canonical,
    publisher: ORGANIZATION,
  }),
};

/**
 * JSON-LD for one entity, or null when it must not be published.
 *
 * Three independent reasons to refuse, all fail-closed:
 *   1. the thing is not real;
 *   2. it has no canonical URL, so there is nothing to identify it by;
 *   3. no emitter is registered for its kind — a new kind stays silent until
 *      someone decides what it should assert, rather than guessing.
 */
export function emit(entity: Entity): JsonLdObject | null {
  if (!entity.real || !entity.canonical) return null;

  const emitter = EMITTERS[entity.kind];
  if (!emitter) return null;

  const output = emitter(entity);
  return output ? { "@context": "https://schema.org", ...output } : null;
}

/** JSON-LD for an entity id. Convenience for page-level call sites. */
export function emitById(id: string): JsonLdObject | null {
  const entity = getEntity(id);
  return entity ? emit(entity) : null;
}

/* -------------------------------- breadcrumbs -------------------------------- */

export interface Crumb {
  name: string;
  url: string;
}

/**
 * BreadcrumbList from an explicit trail.
 *
 * Takes a trail rather than deriving one from graph containment, because a node
 * can have several `partOf` parents (a lesson belongs to a course, and its topic)
 * and only the page knows which ancestry it actually rendered. Emitting a
 * breadcrumb that does not match the visible navigation is a structured-data
 * mismatch that search engines penalise.
 */
export function breadcrumbLd(trail: Crumb[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/* ---------------------------------- glossary --------------------------------- */

/**
 * DefinedTerm — the entity anchor that makes a knowledge graph legible.
 *
 * Kept here rather than in the glossary module so every structured-data shape has
 * one home, which is what makes the registry auditable.
 */
export function definedTermLd(term: {
  name: string;
  description: string;
  url: string;
}): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: term.name,
    description: term.description,
    url: term.url,
    inDefinedTermSet: { "@type": "DefinedTermSet", name: "Frenzsave Glossary" },
  };
}
