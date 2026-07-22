import type {
  DiscoverySurface,
  RankingSignal,
  SearchableEntity,
  SearchCapability,
  SearchIndex,
  SeoAsset,
  SeoAssetKind,
} from "@/lib/platform/search-platform";
import { cn } from "@/lib/utils";

/**
 * The Search & Discovery catalogue — the Enterprise Search Platform described by
 * itself. Read-only, sourced from `lib/platform/search-platform.ts`: every
 * searchable entity, index, ranking signal, SEO asset, discovery surface and
 * search type, mapped to the real code that provides it (or honestly `planned`).
 *
 * No live figures are shown. Search-console-grade query analytics (impressions,
 * CTR, position) are aggregate-only and deliberately not built yet — RFC §5 —
 * so this describes the architecture rather than inventing a metric.
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

export function DiscoveryCatalog({
  entities,
  indexes,
  signals,
  seoAssets,
  seoKinds,
  surfaces,
  capabilities,
}: {
  entities: SearchableEntity[];
  indexes: SearchIndex[];
  signals: RankingSignal[];
  seoAssets: SeoAsset[];
  seoKinds: { id: SeoAssetKind; label: string }[];
  surfaces: DiscoverySurface[];
  capabilities: SearchCapability[];
}) {
  const all = [...entities, ...indexes, ...signals, ...seoAssets, ...surfaces, ...capabilities];
  const live = all.filter((e) => e.status === "live").length;
  const planned = all.filter((e) => e.status === "planned").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Enterprise Search &amp; Discovery Platform described by itself: {all.length} catalogued
        assets ({live} live, {planned} planned). Every live row points at the real module that
        provides it — a test fails the build if one doesn&apos;t. The phased plan behind the planned
        rows is <code className="font-mono text-[11px]">docs/DISCOVERY_PLATFORM_RFC.md</code>.
      </p>

      <Card title={`Searchable entities · ${entities.length}`} blurb="Every object type that participates in search — which index serves it, whether results are permission-filtered, and whether it's publicly indexable.">
        {entities.map((e) => (
          <div key={e.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{e.label}</span>
              <StatusPill status={e.status} />
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{e.indexId}</span>
              {e.permissionAware ? <span className="text-[10px] uppercase tracking-wide text-amber-500">permission-aware</span> : null}
              <span className={cn("text-[10px] uppercase tracking-wide", e.indexable ? "text-green-500" : "text-muted-foreground/60")}>
                {e.indexable ? "indexable" : "not indexed"}
              </span>
              <Src source={e.source} />
            </div>
            {e.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{e.note}</p> : null}
          </div>
        ))}
      </Card>

      <Card title={`Indexes & engines · ${indexes.length}`} blurb="The retrieval backends. In a modular monolith an index is the module that owns retrieval for a surface, not a hosted cluster.">
        {indexes.map((i) => (
          <div key={i.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{i.name}</span>
              <StatusPill status={i.status} />
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{i.kind}</span>
              <Src source={i.source} />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{i.capability}</p>
            <p className="text-[11px] text-muted-foreground/70">Freshness: {i.freshness}</p>
            {i.note ? <p className="text-[11px] text-muted-foreground/70">{i.note}</p> : null}
          </div>
        ))}
      </Card>

      <Card title={`Ranking signals · ${signals.length}`} blurb="The signals actually used to order results, mapped to the code that applies each — not an aspirational ML stack.">
        {signals.map((s) => (
          <div key={s.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              <StatusPill status={s.status} />
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{s.appliesTo}</span>
              <Src source={s.source} />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</p>
            {s.note ? <p className="text-[11px] text-muted-foreground/70">{s.note}</p> : null}
          </div>
        ))}
      </Card>

      <Card title={`SEO & AI discovery · ${seoAssets.length}`} blurb="Server-rendered metadata, structured data, sitemaps and robots. Every structured-data block is veracity-gated and serialised safely.">
        {seoKinds.map((kind) => {
          const inKind = seoAssets.filter((a) => a.kind === kind.id);
          if (inKind.length === 0) return null;
          return (
            <div key={kind.id} className="border-b border-border/40 pb-3 last:border-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{kind.label}</p>
              <div className="mt-1.5 space-y-2">
                {inKind.map((a) => (
                  <div key={a.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <StatusPill status={a.status} />
                      <Src source={a.source} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{a.description}</p>
                    {a.note ? <p className="text-[11px] text-muted-foreground/70">{a.note}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Discovery surfaces · ${surfaces.length}`} blurb="The user-facing surfaces that turn the indexes into discovery.">
          {surfaces.map((s) => (
            <div key={s.id} className="border-b border-border/40 pb-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <StatusPill status={s.status} />
                <Src source={s.source} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</p>
              {s.note ? <p className="text-[11px] text-muted-foreground/70">{s.note}</p> : null}
            </div>
          ))}
        </Card>

        <Card title={`Search types · ${capabilities.length}`} blurb="The brief's search-type matrix, answered honestly — live modes name their code; future modes stay planned.">
          {capabilities.map((c) => (
            <div key={c.id} className="border-b border-border/40 pb-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{c.name}</span>
                <StatusPill status={c.status} />
                <Src source={c.source} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{c.description}</p>
              {c.note ? <p className="text-[11px] text-muted-foreground/70">{c.note}</p> : null}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
