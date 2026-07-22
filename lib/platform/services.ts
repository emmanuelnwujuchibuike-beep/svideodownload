/**
 * The Service Registry — the brief's "Backend Foundation" list of platform
 * gateways/services, mapped to the code that ACTUALLY provides each capability.
 *
 * In a modular monolith a "gateway" is not a separate process; it is the module
 * that owns a cross-cutting capability (docs/ARCHITECTURE.md). So rather than
 * fabricate two dozen empty service shells — which would be exactly the "products
 * that were never built" failure the Reality Ledger exists to prevent — this
 * catalogues the real provider of each named service, honestly staged. The one
 * genuinely-absent service (the event bus) is marked `planned`, not implied.
 *
 * `platform-catalog.test.ts` asserts every non-planned `source` exists on disk.
 */

export type ServiceStatus = "live" | "partial" | "planned";

export interface ServiceDef {
  id: string;
  /** The brief's name. */
  name: string;
  /** One line: the capability it provides. */
  capability: string;
  /** Repo-relative path to the real provider. Empty only when `planned`. */
  source: string;
  status: ServiceStatus;
  note?: string;
}

export const SERVICES: ServiceDef[] = [
  { id: "identity", name: "Identity & Session Service", capability: "One Supabase session powers every module; server-side user resolution.", source: "lib/auth/request-user.ts", status: "live" },
  { id: "auth", name: "Authentication Service", capability: "Sign-in/out, WebAuthn, MFA, PIN, trusted devices.", source: "lib/supabase/server.ts", status: "live" },
  { id: "authorization", name: "Authorization Service", capability: "Module-boundary access predicates + per-row RLS.", source: "lib/platform/module-registry.ts", status: "live" },
  { id: "config-flags", name: "Configuration & Feature-Flag Service", capability: "Runtime flags/config: kill switches, rollouts, plan gates.", source: "lib/platform/flags-store.ts", status: "live" },
  { id: "experiments", name: "Experimentation Service", capability: "Variant assignment + exposure logging.", source: "lib/platform/experiments-store.ts", status: "live" },
  { id: "notifications", name: "Notification Gateway", capability: "Realtime notifications + web push, shared across modules.", source: "lib/push/web-push.ts", status: "live" },
  { id: "analytics", name: "Analytics Gateway", capability: "Unified fire-and-forget event pipeline.", source: "lib/analytics/events.ts", status: "live" },
  { id: "search", name: "Search Gateway", capability: "Cross-surface search index and queries.", source: "lib/search/index.ts", status: "live" },
  { id: "command", name: "Command Gateway", capability: "⌘K command centre; ranking derived from the nav registry.", source: "lib/navigation/queries.ts", status: "live" },
  { id: "workspace", name: "Workspace Gateway", capability: "Product/workspace resolution and switching.", source: "lib/platform/modules.ts", status: "live" },
  { id: "media", name: "Media Gateway", capability: "Streaming, transcode hand-off, namespaced storage.", source: "lib/media/stream.ts", status: "live" },
  { id: "payments", name: "Payments Service", capability: "Subscriptions/entitlements; one plan unlocks Pro everywhere.", source: "lib/paystack/paystack.ts", status: "live" },
  { id: "audit", name: "Audit Service", capability: "Security audit log of sensitive actions.", source: "lib/security/audit-log.ts", status: "live" },
  { id: "observability", name: "Observability & Logging Service", capability: "Diagnostics, memory pressure, error capture.", source: "lib/observability/diagnostics.ts", status: "live" },
  { id: "tracing", name: "Tracing Service", capability: "In-process operation spans + event metering, wired at startup.", source: "lib/observability/trace.ts", status: "partial", note: "In-process/per-instance spans + metrics (real). Distributed tracing (OTLP across web tier + worker) is the exporter seam — planned." },
  { id: "health", name: "Health Service", capability: "Liveness + subsystem health for ops.", source: "app/api/health", status: "live" },
  { id: "rate-limit", name: "Rate-Limit Service", capability: "Upstash-backed limiting on mutations and the API.", source: "lib/rate-limit.ts", status: "live" },
  { id: "moderation", name: "Moderation Service", capability: "Reports, appeals, AI assessments, trust scoring.", source: "lib/moderation", status: "live" },
  { id: "ai", name: "AI Gateway", capability: "Assistant backend over the knowledge corpus.", source: "app/api/assistant", status: "partial", note: "Backend live; no user-facing surface mounted (see the `smart` module veracity)." },
  { id: "admin", name: "Platform Administration Service", capability: "Operate products, money, audience, content, system.", source: "app/admin", status: "live" },
  { id: "eng-metrics", name: "Engineering Metrics", capability: "DORA-style delivery metrics from git history.", source: "lib/platform/engineering-metrics.ts", status: "partial", note: "Proxies from commits (deploy freq, change-fail, MTTR). Lead time + true deploy/incident signals need CI/deploy data." },
  { id: "data-registry", name: "Data Registry / Catalog", capability: "Domains, tables, storage strategies, lifecycle and the Knowledge Fabric.", source: "lib/platform/data-domains.ts", status: "live" },
  { id: "schema-registry", name: "Schema & Migration Service", capability: "Versioned schema evolution; each table ships its RLS in the same migration.", source: "supabase/migrations", status: "live", note: "Migrations applied by hand; a table's create + policies live together." },
  { id: "backup-recovery", name: "Backup & Recovery Service", capability: "Automated backups + point-in-time recovery.", source: "docs/INFRASTRUCTURE.md", status: "partial", note: "Supabase-managed at the platform level (daily backups / PITR by plan), operated from the dashboard — no in-repo backup service." },
  { id: "events-bus", name: "Event Gateway (bus)", capability: "Typed in-process publish/subscribe over the domain-event contracts.", source: "lib/platform/event-bus.ts", status: "live", note: "In-process dispatch (modular monolith). A message broker is the exit-path — see the Integration Registry." },
  { id: "release", name: "Release Service", capability: "Build, deploy, rollback.", source: "vercel.json", status: "partial", note: "Deploy config is in-repo (vercel.json/fly.toml/Dockerfile); execution is Vercel + CI + the CDN." },
];

export function getServices(): ServiceDef[] {
  return SERVICES;
}
