import type {
  DeliveryCapability,
  NotifAiCapability,
  NotifChannel,
  NotifPreference,
  NotifService,
  NotifSource,
} from "@/lib/platform/notification-platform";
import { cn } from "@/lib/utils";

/**
 * The Notification catalogue — the Enterprise Notification Platform described by
 * itself. Read-only, sourced from `lib/platform/notification-platform.ts`: every
 * service, channel, source, delivery capability, preference and AI capability,
 * mapped to the real code that provides it (or honestly `planned`).
 *
 * No live figures here — delivery success/latency + failures are request-time
 * telemetry shown under Health (the Push Delivery monitor); announcements are
 * composed under Trending (the Broadcast composer). This describes the
 * architecture, not a metric it would have to invent.
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

export function NotificationCatalog({
  services,
  channels,
  sources,
  delivery,
  preferences,
  ai,
}: {
  services: NotifService[];
  channels: NotifChannel[];
  sources: NotifSource[];
  delivery: DeliveryCapability[];
  preferences: NotifPreference[];
  ai: NotifAiCapability[];
}) {
  const all = [...services, ...channels, ...delivery, ...preferences, ...ai];
  const live = all.filter((e) => e.status === "live").length;
  const planned = all.filter((e) => e.status === "planned").length;
  const realtime = delivery.filter((d) => d.kind === "realtime");
  const smart = delivery.filter((d) => d.kind === "smart");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Enterprise Notification Platform described by itself: {all.length} catalogued
        capabilities ({live} live, {planned} planned) across {sources.length} sources. Every live
        row points at the real module that provides it — a test fails the build if one doesn&apos;t.
        Delivery health lives under <strong>Health</strong>; announcements under <strong>Trending</strong>.
      </p>

      <Card title={`Services · ${services.length}`} blurb="The backend capabilities — gateway, delivery engine, push/email/realtime, preferences, digest, scheduling and admin.">
        {services.map((s) => (
          <Row key={s.id} name={s.name} status={s.status} source={s.source} description={s.capability} note={s.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Channels · ${channels.length}`} blurb="Where a notification can be delivered. Native + SMS are planned — Frenz is a PWA, so devices get Web Push.">
          {channels.map((c) => (
            <Row key={c.id} name={c.name} status={c.status} source={c.source} description={c.description} note={c.note} />
          ))}
        </Card>

        <Card title={`Sources · ${sources.length}`} blurb="What raises notifications, and the category each fires under.">
          {sources.map((s) => (
            <div key={s.id} className="border-b border-border/40 pb-2 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{s.label}</span>
                <StatusPill status={s.status} />
                {s.category ? (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{s.category}</span>
                ) : null}
              </div>
              {s.note ? <p className="mt-0.5 text-[11px] text-muted-foreground/70">{s.note}</p> : null}
            </div>
          ))}
        </Card>
      </div>

      <Card title={`Delivery · ${delivery.length}`} blurb="Real-time delivery + smart delivery — how and when a notification actually lands.">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Real-time</p>
          <div className="space-y-2">
            {realtime.map((d) => (
              <Row key={d.id} name={d.name} status={d.status} source={d.source} description={d.description} note={d.note} />
            ))}
          </div>
        </div>
        <div className="pt-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Smart delivery</p>
          <div className="space-y-2">
            {smart.map((d) => (
              <Row key={d.id} name={d.name} status={d.status} source={d.source} description={d.description} note={d.note} />
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Personalization · ${preferences.length}`} blurb="What a user can configure — categories, quiet hours, sound, and more.">
          {preferences.map((p) => (
            <Row key={p.id} name={p.name} status={p.status} source={p.source} description={p.description} note={p.note} />
          ))}
        </Card>

        <Card title={`Delivery Intelligence (AI) · ${ai.length}`} blurb="Smart delivery today is rule-based (preferences + quiet hours + digest). The AI layer is honestly planned.">
          {ai.map((c) => (
            <Row key={c.id} name={c.name} status={c.status} source={c.source} description={c.description} note={c.note} />
          ))}
        </Card>
      </div>
    </div>
  );
}
