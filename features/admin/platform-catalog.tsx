import type { RegistryDef } from "@/lib/platform/registries";
import type { ServiceDef } from "@/lib/platform/services";
import type { EventDef } from "@/lib/platform/events-registry";
import type { GovernanceGate } from "@/lib/platform/governance";
import { cn } from "@/lib/utils";

/**
 * The Platform catalogue — an operator/developer view of what the Experience OS is
 * made of: its registries, its services, and its events. Read-only; the data comes
 * from the code registries (`lib/platform/*`), so this can never disagree with them.
 *
 * A plain (non-client) component — it renders imported data and has no
 * interactivity, so it ships no client JS.
 */

const STATUS: Record<string, string> = {
  live: "bg-green-500/15 text-green-500",
  partial: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  planned: "bg-secondary text-muted-foreground",
};

/** How strongly a governance gate is enforced, by its kind. */
const GATE_ENFORCEMENT: Record<GovernanceGate["kind"], { label: string; className: string }> = {
  test: { label: "automated", className: "bg-green-500/15 text-green-500" },
  command: { label: "automated", className: "bg-green-500/15 text-green-500" },
  config: { label: "automated", className: "bg-green-500/15 text-green-500" },
  manual: { label: "manual", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  planned: { label: "planned", className: "bg-secondary text-muted-foreground" },
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[status] ?? STATUS.planned)}>
      {status}
    </span>
  );
}

function Card({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <h3 className="font-semibold">{title}</h3>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">{blurb}</p>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function PlatformCatalog({
  registries,
  services,
  events,
  gates,
}: {
  registries: RegistryDef[];
  services: ServiceDef[];
  events: readonly EventDef[];
  gates: GovernanceGate[];
}) {
  const counts = (items: { status: string }[]) => ({
    live: items.filter((i) => i.status === "live").length,
    total: items.length,
  });
  const r = counts(registries);
  const s = counts(services);
  const automated = gates.filter((g) => g.kind === "test" || g.kind === "command" || g.kind === "config").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Experience OS, described by itself. Every row maps to real code (or is honestly
        marked <em>planned</em>); a <code className="font-mono">live</code> source that stopped
        existing fails <code className="font-mono">platform-catalog.test.ts</code>.
      </p>

      <Card
        title={`Registries · ${r.live}/${r.total} live`}
        blurb="Single-source-of-truth lists the platform derives from. Partial = a real convention, not one declared list."
      >
        {registries.map((x) => (
          <Row key={x.id} name={x.name} sub={x.governs} source={x.source} status={x.status} note={x.note} />
        ))}
      </Card>

      <Card
        title={`Services · ${s.live}/${s.total} live`}
        blurb="Platform capabilities and the module that provides each. In a modular monolith a 'gateway' is a module, not a process."
      >
        {services.map((x) => (
          <Row key={x.id} name={x.name} sub={x.capability} source={x.source} status={x.status} note={x.note} />
        ))}
      </Card>

      <Card
        title={`Events · ${events.length} declared`}
        blurb="Every analytics event and its metadata contract. This list is the single source for the EventType the pipeline accepts."
      >
        {events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/40 pb-2 last:border-0">
            <span className="font-mono text-sm">{e.id}</span>
            <span className="text-xs text-muted-foreground">{e.description}</span>
            {e.metadata ? (
              <span className="w-full text-[11px] text-muted-foreground/70">
                metadata: {e.metadata.map((m) => <code key={m} className="font-mono">{m} </code>)}
              </span>
            ) : null}
          </div>
        ))}
      </Card>

      <Card
        title={`Governance · ${automated}/${gates.length} automated`}
        blurb="The mandatory engineering gates and what enforces each. Automated = a check that fails; manual = a required review; planned = a standard we hold, not yet automated."
      >
        {gates.map((g) => {
          const e = GATE_ENFORCEMENT[g.kind];
          return (
            <div key={g.id} className="border-b border-border/40 pb-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{g.name}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", e.className)}>
                  {e.label}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{g.domain}</span>
                {g.enforcer ? <code className="font-mono text-[11px] text-muted-foreground">{g.enforcer}</code> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{g.requirement}</p>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Row({
  name,
  sub,
  source,
  status,
  note,
}: {
  name: string;
  sub: string;
  source: string;
  status: string;
  note?: string;
}) {
  return (
    <div className="border-b border-border/40 pb-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <StatusPill status={status} />
        {source ? <code className="font-mono text-[11px] text-muted-foreground">{source}</code> : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      {note ? <p className="mt-0.5 text-[11px] italic text-muted-foreground/70">{note}</p> : null}
    </div>
  );
}
