# Infrastructure Decisions

The chosen technology for each capability the registries mark `planned`. "Planned"
here means **decided, not yet built** — waiting on a real trigger, not on a decision.

The bias in every choice, on purpose: **reuse what we already run** (Supabase,
Cloudflare R2, Upstash), **prefer serverless/managed** over anything with a cluster to
operate, and **stay vendor-neutral** where a standard exists. One small team, no ops
headcount — flexibility and low maintenance win over theoretical ceiling.

The machine-readable source is [lib/platform/infra-decisions.ts](../lib/platform/infra-decisions.ts)
(surfaced at `/admin` → Platform). This document is the human mirror.

| Capability | Decision | Why it's the maintainable choice | Build trigger |
|---|---|---|---|
| **Distributed tracing** | OpenTelemetry (OTLP) → managed backend (Grafana Cloud / Axiom free tier) | Vendor-neutral: emit OTLP, swap the backend with no code change. The `setSpanExporter` seam already exists — only add the exporter + endpoint env. | A cross-tier latency issue that logs + in-process spans can't explain. |
| **Message broker** | Upstash QStash (serverless HTTP queue); Supabase pgmq if it must stay in the DB | Serverless, HTTP-native, nothing to run or scale; we already use Upstash. No Kafka/RabbitMQ cluster. | A second consumer needs an event the producer can't call directly, or a module leaves the monolith. |
| **Vector index** | pgvector on the existing Supabase Postgres | No new datastore — one DB to back up/secure/reason about; RLS still applies. | The assistant needs retrieval beyond the generated corpus. |
| **Analytics warehouse** | Postgres materialized views first; managed columnar (Tinybird / ClickHouse Cloud) only if volume forces it | Stay in one database while it serves; defer a second system and its sync/ops until measured need. | An analytics query hits transactional latency, or a dashboard needs sub-second scans over 10M+ rows. |
| **Cold archive** | Cloudflare R2 lifecycle rules (Infrequent Access) | Already on R2 — archival is a bucket lifecycle rule (config), not a new system. | Hot-data growth makes delete-based retention too aggressive. |
| **Data export (GDPR)** | In-app export job: rows + media → signed R2 archive via the worker | No external infra; reuses domain queries, the worker and R2; owner-scoped by the same RLS. | A data-subject export request, or a region that mandates portability. |

## The principle

Every one of these could be "bigger". None of them is bigger than it needs to be
today, and each has a stated trigger that says exactly when to grow it. That is the
maintainable path: the platform stays small and legible until a real signal — not an
architecture diagram — says otherwise.
