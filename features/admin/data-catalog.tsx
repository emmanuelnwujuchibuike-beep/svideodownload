import type { DataDomain } from "@/lib/platform/data-domains";
import type {
  EntityRelationship,
  LifecyclePolicy,
  StorageStrategy,
} from "@/lib/platform/data-platform";
import { cn } from "@/lib/utils";

/**
 * The Data catalogue — the Enterprise Data Platform described by itself: every
 * domain and its tables, the storage strategies, the lifecycle policies and the
 * Knowledge Fabric. Read-only; the data is the code registries (`lib/platform/*`),
 * kept true to the real schema by the data-platform tests. A plain component — no
 * client JS.
 */

const STATUS: Record<string, string> = {
  live: "bg-green-500/15 text-green-500",
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

export function DataCatalog({
  domains,
  storage,
  lifecycle,
  fabric,
}: {
  domains: DataDomain[];
  storage: StorageStrategy[];
  lifecycle: LifecyclePolicy[];
  fabric: EntityRelationship[];
}) {
  const tableCount = domains.reduce((n, d) => n + d.tables.length, 0);
  const liveStorage = storage.filter((s) => s.status === "live").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The database as one governed asset: {tableCount} tables across {domains.length} domains,
        each single-owned and checked against the migrations. Storage tiers and lifecycle we
        don&apos;t run yet (vector index, warehouse, archive, data-export) are honestly{" "}
        <em>planned</em>.
      </p>

      <Card title={`Domains · ${domains.length}`} blurb="Every table, grouped by owner. A new table with no domain fails the test.">
        {domains.map((d) => (
          <div key={d.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{d.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{d.storage.join(" · ")}</span>
              <code className="font-mono text-[11px] text-muted-foreground">{d.owner}</code>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{d.description}</p>
            <p className="mt-1 flex flex-wrap gap-1">
              {d.tables.map((t) => (
                <code key={t} className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {t}
                </code>
              ))}
            </p>
          </div>
        ))}
      </Card>

      <Card title={`Storage strategies · ${liveStorage}/${storage.length} live`} blurb="Where each kind of data lives, and what backs it.">
        {storage.map((s) => (
          <div key={s.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[s.status] ?? STATUS.planned)}>
                {s.status}
              </span>
              <span className="text-xs text-muted-foreground">{s.technology}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.use}</p>
            {s.note ? <p className="mt-0.5 text-[11px] italic text-muted-foreground/70">{s.note}</p> : null}
          </div>
        ))}
      </Card>

      <Card title="Data lifecycle" blurb="Creation → retention → deletion → export → archive. What enforces each stage.">
        {lifecycle.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
            <span className="text-sm font-medium">{p.name}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[p.status] ?? STATUS.planned)}>
              {p.status}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{p.stage}</span>
            {p.mechanism ? <code className="font-mono text-[11px] text-muted-foreground">{p.mechanism}</code> : null}
          </div>
        ))}
      </Card>

      <Card title={`Knowledge Fabric · ${fabric.length} relationships`} blurb="The governed foreign-key graph that makes entities discoverable.">
        {fabric.map((r) => (
          <div key={`${r.from}-${r.to}-${r.via}`} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 text-sm last:border-0">
            <span className="font-medium">{r.from}</span>
            <span className="text-muted-foreground">{r.kind}</span>
            <span className="font-medium">{r.to}</span>
            <code className="font-mono text-[11px] text-muted-foreground">via {r.via}</code>
          </div>
        ))}
      </Card>
    </div>
  );
}
