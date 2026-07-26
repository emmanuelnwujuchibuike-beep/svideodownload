import type {
  ExtensibilityCapability,
  FrameworkService,
  LifecycleCapability,
  NavigationCapability,
  RegisteredWorkspace,
  ShellCapability,
} from "@/lib/platform/workspace-platform";
import { cn } from "@/lib/utils";

/**
 * The Workspace Framework catalogue — the Enterprise Workspace Framework described
 * by itself. Read-only, sourced from `lib/platform/workspace-platform.ts`: every
 * registered workspace, framework service, shell capability, navigation capability,
 * lifecycle/shared-platform capability and extensibility/AI capability, mapped to
 * the real code that provides it (or honestly `planned`).
 *
 * The registered-workspaces card is a VIEW over the Product Genome, so it can never
 * show a workspace the module registry doesn't have. The independence + plugin rows
 * are honestly `planned`: this is a modular monolith, not a micro-frontend mesh.
 */

const STATUS: Record<string, string> = {
  live: "bg-green-500/15 text-green-500",
  partial: "bg-amber-500/15 text-amber-500",
  planned: "bg-secondary text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[status] ?? STATUS.planned)}>
      {status}
    </span>
  );
}

function Src({ source }: { source: string }) {
  if (!source) return null;
  return <code className="font-mono text-[11px] text-muted-foreground">{source}</code>;
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

function Row({
  name,
  status,
  source,
  description,
  note,
  tag,
}: {
  name: string;
  status: string;
  source: string;
  description?: string;
  note?: string;
  tag?: string;
}) {
  return (
    <div className="border-b border-border/40 pb-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <StatusPill status={status} />
        {tag ? <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span> : null}
        <Src source={source} />
      </div>
      {description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p> : null}
      {note ? <p className="text-[11px] text-muted-foreground/70">{note}</p> : null}
    </div>
  );
}

const TIER_STYLE: Record<string, string> = {
  everyone: "text-green-500",
  pro: "text-violet-500",
  business: "text-blue-500",
  admin: "text-amber-500",
};

export function WorkspaceCatalog({
  workspaces,
  services,
  shell,
  navigation,
  lifecycle,
  extensibility,
}: {
  workspaces: RegisteredWorkspace[];
  services: FrameworkService[];
  shell: ShellCapability[];
  navigation: NavigationCapability[];
  lifecycle: LifecycleCapability[];
  extensibility: ExtensibilityCapability[];
}) {
  const all = [...services, ...shell, ...navigation, ...lifecycle, ...extensibility];
  const live = all.filter((e) => e.status === "live").length;
  const partial = all.filter((e) => e.status === "partial").length;
  const planned = all.filter((e) => e.status === "planned").length;
  const claimable = workspaces.filter((w) => w.claimable).length;

  const shared = lifecycle.filter((l) => l.kind === "shared");
  const lifecycleStates = lifecycle.filter((l) => l.kind === "lifecycle");
  const independence = lifecycle.filter((l) => l.kind === "independence");
  const ai = extensibility.filter((e) => e.kind === "ai");
  const plugins = extensibility.filter((e) => e.kind === "plugin");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Enterprise Workspace Framework described by itself: {all.length} catalogued
        capabilities ({live} live, {partial} partial, {planned} planned) across {workspaces.length}{" "}
        registered workspaces. Every live/partial row points at the real module that provides it — a
        test fails the build if one doesn&apos;t. This is a modular monolith: the shared platform is
        real; independent deployment + plugins are honestly planned. Doc:{" "}
        <code className="font-mono text-[11px]">docs/WORKSPACE_PLATFORM.md</code>.
      </p>

      <Card
        title={`Registered workspaces · ${claimable} of ${workspaces.length} claimable`}
        blurb="A view over the Product Genome — add a workspace = one entry in lib/platform/modules.ts. Whether it may be claimed as real is inherited from its Reality-Ledger veracity."
      >
        {workspaces.map((w) => (
          <div key={w.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{w.name}</span>
              <StatusPill status={w.status === "live" ? "live" : w.status === "beta" ? "partial" : "planned"} />
              <span className={cn("text-[10px] font-medium uppercase tracking-wide", TIER_STYLE[w.tier])}>{w.tier}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{w.stage}</span>
              {w.provingRoute ? (
                <code className="font-mono text-[11px] text-muted-foreground">{w.provingRoute}</code>
              ) : (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">not claimable</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{w.tagline}</p>
          </div>
        ))}
      </Card>

      <Card
        title={`Framework services · ${services.length}`}
        blurb="The brief's backend architecture, mapped to the real provider of each. In a monolith a service is the module that owns a capability, not a separate process."
      >
        {services.map((s) => (
          <Row key={s.id} name={s.name} status={s.status} source={s.source} description={s.capability} note={s.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Platform Shell · ${shell.length}`} blurb="One reusable authenticated frame every workspace is hosted in — nav, search, notifications, theme, identity.">
          {shell.map((s) => (
            <Row key={s.id} name={s.name} status={s.status} source={s.source} description={s.description} note={s.note} />
          ))}
        </Card>

        <Card title={`Navigation Engine · ${navigation.length}`} blurb="One nav registry every surface is a view over; every destination is route-verified.">
          {navigation.map((n) => (
            <Row key={n.id} name={n.name} status={n.status} source={n.source} description={n.description} note={n.note} />
          ))}
        </Card>
      </div>

      <Card title={`Lifecycle · ${lifecycleStates.length}`} blurb="The states a workspace moves through — declared maturity, runtime activation via flags, configuration and schema migration.">
        {lifecycleStates.map((l) => (
          <Row key={l.id} name={l.name} status={l.status} source={l.source} description={l.description} note={l.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Shared platform · ${shared.length}`} blurb="What every workspace inherits by construction — the real value of the monolith. Shared, not duplicated.">
          {shared.map((l) => (
            <Row key={l.id} name={l.name} status={l.status} source={l.source} description={l.description} note={l.note} />
          ))}
        </Card>

        <Card title={`Independent evolution · ${independence.length}`} blurb="The micro-frontend exit-path. Boundaries are enforced; independent deployment is a deliberate, documented future, not a pretence.">
          {independence.map((l) => (
            <Row key={l.id} name={l.name} status={l.status} source={l.source} description={l.description} note={l.note} />
          ))}
        </Card>

        <Card title={`AI understanding · ${ai.length}`} blurb="The machine-readable substrate that already lets an AI reason about the platform. Real today; a runtime assistant that acts on it is planned.">
          {ai.map((e) => (
            <Row key={e.id} name={e.name} status={e.status} source={e.source} description={e.description} note={e.note} />
          ))}
        </Card>

        <Card title={`Plugin Framework · ${plugins.length}`} blurb="A security-sensitive extension sandbox — entirely planned. Nothing here is implied as built.">
          {plugins.map((e) => (
            <Row key={e.id} name={e.name} status={e.status} source={e.source} description={e.description} note={e.note} />
          ))}
        </Card>
      </div>
    </div>
  );
}
