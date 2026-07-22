/**
 * Data Platform governance — storage strategies, lifecycle policies and the
 * Knowledge Fabric relationships that sit over the Data Domain Registry.
 *
 * The brief's "Database Strategy", "Data Lifecycle" and "Knowledge Fabric", made
 * real and honest: each entry points at the code/infra that provides it, and the
 * things this stack does NOT have yet (a vector index, an OLAP warehouse, cold
 * archive) are `planned`, not fabricated. `data-platform.test.ts` enforces it.
 */

/* ------------------------------ storage strategy ---------------------------- */

export type StorageStatus = "live" | "planned";

export interface StorageStrategy {
  id: string;
  name: string;
  /** The technology backing it. */
  technology: string;
  use: string;
  /** Repo-relative access point. Empty only when `planned`. */
  source: string;
  status: StorageStatus;
  note?: string;
}

export const STORAGE_STRATEGIES: StorageStrategy[] = [
  { id: "relational", name: "Relational store", technology: "Supabase Postgres", use: "The system of record for every domain; RLS-enforced.", source: "lib/supabase/server.ts", status: "live" },
  { id: "object", name: "Object storage", technology: "Cloudflare R2 + Supabase Storage", use: "Media bytes, attachments, exports — namespaced per module.", source: "lib/storage/index.ts", status: "live" },
  { id: "cache", name: "Cache", technology: "Upstash Redis", use: "Hot reads, rate limits, single-flight dedup (in-memory fallback in dev).", source: "lib/cache.ts", status: "live" },
  { id: "search", name: "Search index", technology: "In-app index over the relational store", use: "Cross-surface search + navigation ranking.", source: "lib/search/index.ts", status: "live" },
  { id: "event-log", name: "Event stream", technology: "Append-only `events` table", use: "Unified analytics + experiment exposures.", source: "lib/analytics/events.ts", status: "live" },
  { id: "vector", name: "Vector index", technology: "pgvector (planned)", use: "Semantic search / retrieval for the assistant.", source: "", status: "planned", note: "No embeddings pipeline yet; add pgvector when the assistant needs retrieval." },
  { id: "warehouse", name: "Analytics warehouse", technology: "Dedicated OLAP (planned)", use: "Large-scale analytical queries off the transactional path.", source: "", status: "planned", note: "Analytics live in Postgres today; a warehouse is deferred until query volume needs it." },
  { id: "archive", name: "Cold archive", technology: "Object-storage archive (planned)", use: "Aged, rarely-read data moved out of the hot store.", source: "", status: "planned", note: "Retention today is delete-based; an archive tier is deferred." },
];

export function getStorageStrategies(): StorageStrategy[] {
  return STORAGE_STRATEGIES;
}

/* ------------------------------ data lifecycle ------------------------------ */

export type LifecycleStage = "retention" | "deletion" | "export" | "archive";
export type LifecycleStatus = "live" | "planned";

export interface LifecyclePolicy {
  id: string;
  name: string;
  stage: LifecycleStage;
  /** What enforces it (a cron route, a service). Empty only when `planned`. */
  mechanism: string;
  status: LifecycleStatus;
  note?: string;
}

export const LIFECYCLE_POLICIES: LifecyclePolicy[] = [
  { id: "account-deletion", name: "Account deletion", stage: "deletion", mechanism: "app/api/cron/purge-deleted-accounts/route.ts", status: "live", note: "Requested via the deletion table; purged after the grace window by cron." },
  { id: "disappearing-messages", name: "Disappearing messages", stage: "deletion", mechanism: "app/api/cron/disappearing-messages/route.ts", status: "live" },
  { id: "push-log-retention", name: "Push-log retention", stage: "retention", mechanism: "app/api/cron/push-log-cleanup/route.ts", status: "live", note: "Delivery logs pruned on a schedule." },
  { id: "data-export", name: "Personal data export", stage: "export", mechanism: "", status: "planned", note: "GDPR-style export is a declared obligation; not yet built (privacy_settings covers consent/visibility today)." },
  { id: "cold-archive", name: "Archival", stage: "archive", mechanism: "", status: "planned", note: "Depends on the archive storage tier above." },
];

export function getLifecyclePolicies(): LifecyclePolicy[] {
  return LIFECYCLE_POLICIES;
}

/* ----------------------------- knowledge fabric ----------------------------- */

export type RelationshipKind = "has-many" | "belongs-to" | "many-to-many";

export interface EntityRelationship {
  from: string;
  to: string;
  kind: RelationshipKind;
  /** The table that materialises the relationship (must exist in a migration). */
  via: string;
}

/**
 * The Knowledge Fabric — the governed relationships that make entities discoverable.
 * Documents the real foreign-key graph; each `via` is a real table, checked by the test.
 */
export const KNOWLEDGE_FABRIC: EntityRelationship[] = [
  { from: "user", to: "post", kind: "has-many", via: "posts" },
  { from: "user", to: "user", kind: "many-to-many", via: "follows" },
  { from: "user", to: "user", kind: "many-to-many", via: "friendships" },
  { from: "post", to: "comment", kind: "has-many", via: "post_comments" },
  { from: "post", to: "reaction", kind: "has-many", via: "post_reactions" },
  { from: "post", to: "media", kind: "has-many", via: "post_media" },
  { from: "conversation", to: "message", kind: "has-many", via: "messages" },
  { from: "conversation", to: "user", kind: "many-to-many", via: "conversation_members" },
  { from: "user", to: "notification", kind: "has-many", via: "notifications" },
  { from: "user", to: "subscription", kind: "belongs-to", via: "subscriptions" },
  { from: "user", to: "story", kind: "has-many", via: "stories" },
  { from: "content", to: "version", kind: "has-many", via: "content_versions" },
];

export function getKnowledgeFabric(): EntityRelationship[] {
  return KNOWLEDGE_FABRIC;
}
