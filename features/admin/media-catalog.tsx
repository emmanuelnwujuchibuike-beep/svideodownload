import type {
  DeliveryCapability,
  MediaAiCapability,
  MediaService,
  MediaSignal,
  PipelineStage,
  StorageTier,
  SupportedMedia,
} from "@/lib/platform/media-platform";
import { cn } from "@/lib/utils";

/**
 * The Media catalogue — the Enterprise Media Platform described by itself.
 * Read-only, sourced from `lib/platform/media-platform.ts`: every media service,
 * storage tier, pipeline stage, delivery capability, AI capability and
 * observability signal, mapped to the real code that provides it (or honestly
 * `planned`).
 *
 * No live figures are shown here — playback QoE, egress and stream health are
 * request-time telemetry surfaced under Health / at /api/health, not a static
 * count. This describes the architecture, not a metric it would have to invent.
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

/** One row: name + status + source + description (+ optional note). */
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
  description: string;
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
      <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      {note ? <p className="text-[11px] text-muted-foreground/70">{note}</p> : null}
    </div>
  );
}

export function MediaCatalog({
  services,
  storage,
  pipeline,
  delivery,
  ai,
  observability,
  supported,
}: {
  services: MediaService[];
  storage: StorageTier[];
  pipeline: PipelineStage[];
  delivery: DeliveryCapability[];
  ai: MediaAiCapability[];
  observability: MediaSignal[];
  supported: SupportedMedia[];
}) {
  const all = [...services, ...storage, ...pipeline, ...delivery, ...ai, ...observability];
  const live = all.filter((e) => e.status === "live").length;
  const planned = all.filter((e) => e.status === "planned").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Enterprise Media Platform described by itself: {all.length} catalogued capabilities
        ({live} live, {planned} planned) plus {supported.length} media kinds. Every live row points
        at the real module that provides it — a test fails the build if one doesn&apos;t. Runtime
        media telemetry (playback QoE, egress, stream health) lives under Health and at{" "}
        <code className="font-mono text-[11px]">/api/health</code>.
      </p>

      <Card title={`Services · ${services.length}`} blurb="The backend capabilities. In a modular monolith a service is the module that owns a capability, not a separate process.">
        {services.map((s) => (
          <Row key={s.id} name={s.name} status={s.status} source={s.source} description={s.capability} note={s.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Storage tiers · ${storage.length}`} blurb="Where media lives, and the lifecycle rules over it.">
          {storage.map((t) => (
            <Row key={t.id} name={t.name} status={t.status} source={t.source} description={t.description} note={t.note} />
          ))}
        </Card>

        <Card title={`Delivery · ${delivery.length}`} blurb="Global CDN, adaptive and device/network-aware delivery.">
          {delivery.map((d) => (
            <Row key={d.id} name={d.name} status={d.status} source={d.source} description={d.description} note={d.note} />
          ))}
        </Card>
      </div>

      <Card title={`Media pipeline · ${pipeline.length}`} blurb="The Media Pipeline™ — validation, transcode, thumbnails, captions, moderation and the analysis stages, staged honestly.">
        {pipeline.map((p) => (
          <Row key={p.id} name={p.name} status={p.status} source={p.source} description={p.description} note={p.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Media intelligence · ${ai.length}`} blurb="Media Intelligence™ — captions and moderation ship today; the enhancement/detection stack is honestly planned.">
          {ai.map((c) => (
            <Row key={c.id} name={c.name} status={c.status} source={c.source} description={c.description} note={c.note} />
          ))}
        </Card>

        <Card title={`Observability · ${observability.length}`} blurb="The media signals we collect — playback quality, stream health and egress.">
          {observability.map((o) => (
            <Row key={o.id} name={o.name} status={o.status} source={o.source} description={o.description} note={o.note} />
          ))}
        </Card>
      </div>

      <Card title={`Supported media · ${supported.length}`} blurb="Every media kind and the service that handles it. Future kinds (AI-generated, 3D/AR/VR) are planned.">
        <div className="flex flex-wrap gap-2">
          {supported.map((m) => (
            <span
              key={m.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                m.status === "live"
                  ? "border-green-500/30 text-foreground"
                  : m.status === "partial"
                    ? "border-amber-500/30 text-foreground"
                    : "border-border/60 text-muted-foreground",
              )}
              title={m.note ?? (m.handledBy ? `Handled by ${m.handledBy}` : "Planned")}
            >
              {m.label}
              {m.status !== "live" ? <StatusPill status={m.status} /> : null}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
