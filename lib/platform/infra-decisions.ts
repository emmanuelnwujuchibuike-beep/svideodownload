/**
 * Infrastructure Decisions — the chosen technology for each capability the
 * registries mark `planned`, so "planned" means "decided, not yet built" rather
 * than "undecided". Lightweight ADRs as data.
 *
 * The bias in every choice is deliberate and consistent: REUSE what we already run
 * (Supabase, Cloudflare R2, Upstash), prefer SERVERLESS/MANAGED over anything with a
 * cluster to operate, and stay VENDOR-NEUTRAL where a standard exists (OpenTelemetry)
 * so a backend can be swapped without touching code. That is what keeps the platform
 * flexible and cheap to maintain as it grows — one small team, no ops headcount.
 *
 * Mirrored for humans in `docs/INFRA_DECISIONS.md`.
 */

export type DecisionStatus =
  /** Chosen and documented; not built yet (waiting on its trigger). */
  | "decided"
  /** Already in use in the platform. */
  | "adopted";

export interface InfraDecision {
  id: string;
  /** The capability this decides. */
  capability: string;
  /** The chosen technology/approach. */
  decision: string;
  /** Why this is the flexible, low-maintenance choice. */
  rationale: string;
  /** The signal that says "build it now". */
  trigger: string;
  status: DecisionStatus;
}

export const INFRA_DECISIONS: InfraDecision[] = [
  {
    id: "distributed-tracing",
    capability: "Distributed tracing across the web tier + worker",
    decision: "OpenTelemetry (OTLP) exporter → a managed backend (Grafana Cloud / Axiom free tier)",
    rationale: "Vendor-neutral: the app emits OTLP, the backend is swappable with zero code change. The `setSpanExporter` seam already exists (lib/observability/trace.ts) — only the exporter + endpoint env are added.",
    trigger: "First time a cross-tier latency issue can't be diagnosed from logs + in-process spans.",
    status: "decided",
  },
  {
    id: "message-broker",
    capability: "Durable async fan-out (queues/topics/DLQ/delayed jobs)",
    decision: "Upstash QStash (serverless HTTP queue) for jobs; Supabase pgmq if it must stay in the DB",
    rationale: "Serverless and HTTP-native — nothing to run or scale, fits Vercel/edge, and we already use Upstash. No Kafka/RabbitMQ cluster to operate.",
    trigger: "A second consumer needs an event the producer can't call directly, or a module leaves the monolith.",
    status: "decided",
  },
  {
    id: "vector-index",
    capability: "Semantic search / retrieval for the assistant",
    decision: "pgvector on the existing Supabase Postgres",
    rationale: "No new datastore: one database to back up, secure and reason about; RLS still applies to embeddings. Easiest possible thing to maintain.",
    trigger: "The assistant needs retrieval over content/knowledge beyond the generated corpus.",
    status: "decided",
  },
  {
    id: "analytics-warehouse",
    capability: "Large-scale analytical queries off the transactional path",
    decision: "Postgres materialized views first; a managed columnar store (Tinybird / ClickHouse Cloud) only if volume forces it",
    rationale: "Stay in the one database as long as it serves — mat-views cover a lot cheaply. Defer a second system (and its sync/ops) until measured need, not before.",
    trigger: "An analytics query starts affecting transactional latency, or a dashboard needs sub-second scans over 10M+ rows.",
    status: "decided",
  },
  {
    id: "cold-archive",
    capability: "Cold storage for aged, rarely-read data",
    decision: "Cloudflare R2 lifecycle rules (Infrequent Access tier)",
    rationale: "Already on R2 — archival is a bucket lifecycle rule (config), not a new system. Bytes move to a cheaper tier automatically.",
    trigger: "Storage growth on hot data makes retention-by-delete too aggressive.",
    status: "decided",
  },
  {
    id: "data-export",
    capability: "GDPR-style personal data export",
    decision: "In-app export job: assemble a user's rows + media into a signed R2 archive, delivered by the worker",
    rationale: "No external infra — reuses the domain queries, the worker and R2. Owner-scoped by the same RLS as everything else.",
    trigger: "A data-subject export request, or shipping in a region that mandates portability.",
    status: "decided",
  },
];

export function getInfraDecisions(): InfraDecision[] {
  return INFRA_DECISIONS;
}
