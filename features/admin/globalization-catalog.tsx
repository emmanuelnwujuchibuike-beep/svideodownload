import type {
  CurrencyCapability,
  GlobalizationAiCapability,
  GlobalizationService,
  LocalizationSurface,
  RegionalFormat,
  SupportedLocale,
  TimezoneCapability,
} from "@/lib/platform/globalization-platform";
import { cn } from "@/lib/utils";

/**
 * The Globalization catalogue — the Enterprise Globalization Platform described by
 * itself. Read-only, sourced from `lib/platform/globalization-platform.ts`: every
 * locale, service, regional format, currency + timezone capability, localized
 * surface and AI capability, mapped to the real code that provides it (or honestly
 * `planned`).
 *
 * Locale coverage is MEASURED from the catalogue, never declared — so this cannot
 * show a language as ready when its strings do not exist. That is the whole point:
 * the operator sees the honest localization frontier, not a marketing map.
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

/** One capability row shared by services / formats / currency / timezone. */
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

export function GlobalizationCatalog({
  locales,
  services,
  formats,
  currency,
  timezone,
  surfaces,
  ai,
}: {
  locales: SupportedLocale[];
  services: GlobalizationService[];
  formats: RegionalFormat[];
  currency: CurrencyCapability[];
  timezone: TimezoneCapability[];
  surfaces: LocalizationSurface[];
  ai: GlobalizationAiCapability[];
}) {
  const all = [...services, ...formats, ...currency, ...timezone, ...surfaces, ...ai];
  const live = all.filter((e) => e.status === "live").length;
  const partial = all.filter((e) => e.status === "partial").length;
  const planned = all.filter((e) => e.status === "planned").length;
  const offerable = locales.filter((l) => l.availability !== "planned");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Enterprise Globalization Platform described by itself: {all.length} catalogued
        capabilities ({live} live, {partial} partial, {planned} planned) across {locales.length}{" "}
        declared locales. Every live/partial row points at the real module that provides it — a test
        fails the build if one doesn&apos;t. The companion doc is{" "}
        <code className="font-mono text-[11px]">docs/GLOBALIZATION_PLATFORM.md</code>.
      </p>

      <Card
        title={`Locales · ${offerable.length} of ${locales.length} offerable`}
        blurb="Declared as a routing plan; offered only when translated. Coverage is measured from the catalogue, so a language can never be offered before its strings exist."
      >
        {locales.map((l) => (
          <div key={l.code} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{l.endonym}</span>
              <span className="text-[11px] text-muted-foreground">{l.name}</span>
              <StatusPill status={l.availability === "live" ? "live" : l.availability === "partial" ? "partial" : "planned"} />
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{l.code}</span>
              {l.direction === "rtl" ? <span className="text-[10px] uppercase tracking-wide text-amber-500">rtl</span> : null}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full", l.coveragePct >= 90 ? "bg-green-500" : l.coveragePct > 0 ? "bg-amber-500" : "bg-muted-foreground/30")}
                  style={{ width: `${Math.max(2, l.coveragePct)}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{l.coveragePct}%</span>
            </div>
          </div>
        ))}
      </Card>

      <Card
        title={`Services · ${services.length}`}
        blurb="The brief's backend architecture, mapped to the real provider of each capability. Distinct capabilities may share a module — the id is what's unique."
      >
        {services.map((s) => (
          <Row key={s.id} name={s.name} status={s.status} source={s.source} description={s.capability} note={s.note} />
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Regional formats · ${formats.length}`} blurb="Formatting pays off before any string is translated — a date read wrongly is silently incorrect, not merely foreign.">
          {formats.map((f) => (
            <Row key={f.id} name={f.name} status={f.status} source={f.source} description={f.description} note={f.note} />
          ))}
        </Card>

        <Card title={`Localized surfaces · ${surfaces.length}`} blurb="The localization frontier — which workspaces read the catalogue today, and which are still English-only.">
          {surfaces.map((s) => (
            <Row key={s.id} name={s.label} status={s.status} source={s.source} note={s.note} />
          ))}
        </Card>

        <Card title={`Multi-currency · ${currency.length}`} blurb="Displaying and denominating money correctly across regions. Revenue mechanics are owned by the Commerce Registry.">
          {currency.map((c) => (
            <Row key={c.id} name={c.name} status={c.status} source={c.source} description={c.description} note={c.note} />
          ))}
        </Card>

        <Card title={`Time zones · ${timezone.length}`} blurb="Time display is locale-aware today; true per-user timezone awareness is mostly planned — and quiet hours are honestly a UTC window, not a zone.">
          {timezone.map((t) => (
            <Row key={t.id} name={t.name} status={t.status} source={t.source} description={t.description} note={t.note} />
          ))}
        </Card>
      </div>

      <Card title={`Localization Intelligence (AI) · ${ai.length}`} blurb="All planned — and the absent machine-translation row is a deliberate position: 0086 treats `machine` as a status a human must review before it counts.">
        {ai.map((a) => (
          <Row key={a.id} name={a.name} status={a.status} source={a.source} description={a.description} />
        ))}
      </Card>
    </div>
  );
}
