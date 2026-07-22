import type { DomainEventDef } from "@/lib/platform/domain-events";
import type { IntegrationDef } from "@/lib/platform/integration-registry";
import { cn } from "@/lib/utils";

/**
 * The Communication catalogue — the ecosystem's comms backbone described by itself:
 * the domain events that flow, and every integration surface (APIs, realtime,
 * webhooks, workflows) that carries them. Read-only; the data is the code registries
 * (`lib/platform/*`), so it can't disagree with them. A plain component — no client JS.
 */

const STATUS: Record<string, string> = {
  live: "bg-green-500/15 text-green-500",
  partial: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  planned: "bg-secondary text-muted-foreground",
};

function Card({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <h3 className="font-semibold">{title}</h3>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">{blurb}</p>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function CommunicationCatalog({
  events,
  integrations,
}: {
  events: readonly DomainEventDef[];
  integrations: IntegrationDef[];
}) {
  const live = integrations.filter((i) => i.status === "live").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The communication backbone, described by itself. Contracts and surfaces map to real
        code; a message broker and a service mesh are honestly <em>planned</em> — a modular
        monolith with no inter-service hops doesn&apos;t have them yet.
      </p>

      <Card
        title={`Domain events · ${events.length}`}
        blurb="Business event contracts with typed payloads. The event bus is typed against these."
      >
        {events.map((e) => (
          <div key={e.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm">{e.id}</code>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {e.domain}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{e.description}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              payload: {e.payload.map((k) => <code key={k} className="font-mono">{k} </code>)}
            </p>
          </div>
        ))}
      </Card>

      <Card
        title={`Integration surfaces · ${live}/${integrations.length} live`}
        blurb="Every way things talk: REST, the event bus, realtime, webhooks, workflows, the worker, streaming — and the infra deliberately deferred."
      >
        {integrations.map((i) => (
          <div key={i.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{i.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[i.status] ?? STATUS.planned)}>
                {i.status}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{i.kind}</span>
              {i.source ? <code className="font-mono text-[11px] text-muted-foreground">{i.source}</code> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{i.description}</p>
            {i.note ? <p className="mt-0.5 text-[11px] italic text-muted-foreground/70">{i.note}</p> : null}
          </div>
        ))}
      </Card>
    </div>
  );
}
