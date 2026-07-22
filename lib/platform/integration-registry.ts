/**
 * Integration Registry — every way things talk to each other in the ecosystem.
 *
 * The brief's "Integration Registry™": one catalogue of the communication surfaces
 * — REST APIs, the domain event bus, realtime channels, inbound webhooks, scheduled
 * workflows, the media worker, streaming — each mapped to the real code that
 * provides it. And, honestly, the pieces the brief names that a modular monolith
 * does NOT have yet (a message broker, a service mesh, a workflow orchestrator) are
 * marked `planned` with the reason, not fabricated. Faking a service mesh for an app
 * with no inter-service network hops is exactly the "product that was never built"
 * failure the Reality Ledger exists to stop.
 *
 * Kept honest by `integration-registry.test.ts` (live/partial ⇒ source exists;
 * planned ⇒ no source).
 */

export type IntegrationKind =
  | "rest-api"
  | "domain-event"
  | "realtime"
  | "webhook"
  | "workflow"
  | "background-job"
  | "streaming"
  | "broker"
  | "service-mesh";

export type IntegrationStatus = "live" | "partial" | "planned";

export interface IntegrationDef {
  id: string;
  name: string;
  kind: IntegrationKind;
  description: string;
  /** Repo-relative source of the provider. Empty only when `planned`. */
  source: string;
  status: IntegrationStatus;
  note?: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
  { id: "rest-api", name: "REST API", kind: "rest-api", description: "The developer + app HTTP surface, /api/v1.", source: "lib/platform/api-registry.ts", status: "live" },
  { id: "domain-events", name: "Domain event bus", kind: "domain-event", description: "Typed in-process pub/sub over the domain-event contracts.", source: "lib/platform/event-bus.ts", status: "live" },
  { id: "realtime", name: "Realtime channels", kind: "realtime", description: "Live messaging, notifications, presence and typing.", source: "lib/social/messages.ts", status: "live", note: "Supabase Realtime (websocket) channels." },
  { id: "webhook-stream", name: "Cloudflare Stream webhook", kind: "webhook", description: "Inbound: a media transcode finished.", source: "app/api/webhooks/stream/route.ts", status: "live" },
  { id: "webhook-paystack", name: "Paystack webhook", kind: "webhook", description: "Inbound: payment / subscription events.", source: "app/api/paystack", status: "live" },
  { id: "cron-workflows", name: "Scheduled workflows", kind: "workflow", description: "Cron-driven long-running jobs.", source: "app/api/cron", status: "live", note: "digest, trending, friend-reminders, disappearing-messages, purge-deleted-accounts, push-log-cleanup." },
  { id: "worker", name: "Media worker", kind: "background-job", description: "Out-of-process transcode/extraction; scales independently of the web tier.", source: "lib/worker.ts", status: "live" },
  { id: "offline-queue", name: "Offline action queue", kind: "background-job", description: "Client-side durable retry queue for actions taken offline.", source: "lib/offline/action-queue.ts", status: "partial", note: "Client-side; server-side durable queues use Upstash where needed." },
  { id: "streaming-media", name: "HLS media streaming", kind: "streaming", description: "Adaptive video streaming to every client.", source: "lib/media/stream.ts", status: "live", note: "Cloudflare Stream." },

  /* ── named by the brief, genuinely absent — planned, not faked ── */
  { id: "message-broker", name: "Message broker", kind: "broker", description: "Queues/topics/DLQ/priority/delayed delivery.", source: "", status: "planned", note: "Supabase Realtime + Upstash cover today's needs. A dedicated broker (Kafka/SQS) is the exit-path when a module leaves the monolith — not needed at monolith scale." },
  { id: "service-mesh", name: "Service mesh", kind: "service-mesh", description: "Discovery, routing, retries, circuit breakers between services.", source: "", status: "planned", note: "N/A for one deployable with no inter-service network hops. The per-module exit path (ARCHITECTURE.md) is the future seam." },
  { id: "workflow-engine", name: "Workflow orchestrator", kind: "workflow", description: "Durable, long-running, multi-step workflow coordination.", source: "", status: "planned", note: "Long-running flows run as cron + worker jobs today; a formal orchestrator (Temporal/Step Functions) is deferred until a flow genuinely needs one." },
];

export function getIntegrations(): IntegrationDef[] {
  return INTEGRATIONS;
}

/** Counts for the admin summary. */
export function integrationSummary(): { live: number; total: number } {
  return { live: INTEGRATIONS.filter((i) => i.status === "live").length, total: INTEGRATIONS.length };
}
