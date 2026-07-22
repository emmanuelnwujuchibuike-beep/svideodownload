import type { EngineeringAsset, EngineeringAssetKind } from "@/lib/platform/engineering-registry";
import type { EngineeringStandard, StandardArea } from "@/lib/platform/engineering-standards";
import { cn } from "@/lib/utils";

/**
 * The Engineering catalogue — the Developer Experience Platform described by
 * itself. Read-only, sourced from `engineering-registry.ts` and
 * `engineering-standards.ts`: every doc, generator, SDK, standard and registry a
 * contributor reaches for, and the conventions with how each is enforced.
 *
 * DORA delivery metrics and component adoption are measured by CLI
 * (`npm run metrics:engineering` / `design:adoption`) from git and the source
 * tree, so they're named here rather than shown as a request-time figure that
 * would have to be estimated.
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

export function EngineeringCatalog({
  assets,
  kinds,
  standards,
  areas,
}: {
  assets: EngineeringAsset[];
  kinds: { id: EngineeringAssetKind; label: string }[];
  standards: EngineeringStandard[];
  areas: { id: StandardArea; label: string }[];
}) {
  const live = assets.filter((a) => a.status === "live").length;
  const areaLabel = new Map(areas.map((a) => [a.id, a.label]));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Developer Experience Platform described by itself: {assets.length} engineering assets
        ({live} live) and {standards.length} enforced standards. Delivery metrics come from{" "}
        <code className="font-mono text-[11px]">npm run metrics:engineering</code>; component adoption
        from <code className="font-mono text-[11px]">npm run design:adoption</code>.
      </p>

      <Card title={`Engineering registry · ${assets.length}`} blurb="Every doc, generator, SDK, standard and registry — with its owner and source.">
        {kinds.map((kind) => {
          const inKind = assets.filter((a) => a.kind === kind.id);
          if (inKind.length === 0) return null;
          return (
            <div key={kind.id} className="border-b border-border/40 pb-3 last:border-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{kind.label}</p>
              <div className="mt-1.5 space-y-2">
                {inKind.map((a) => (
                  <div key={a.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[a.status] ?? STATUS.planned)}>
                        {a.status}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{a.owner}</span>
                      {a.source ? <code className="font-mono text-[11px] text-muted-foreground">{a.source}</code> : null}
                      {a.command ? <code className="font-mono text-[11px] text-primary">{a.command}</code> : null}
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

      <Card title={`Engineering standards · ${standards.length}`} blurb="The conventions every contributor and AI assistant follows — and how each is enforced.">
        {standards.map((s) => (
          <div key={s.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {areaLabel.get(s.area) ?? s.area}
              </span>
              {s.reference ? <code className="font-mono text-[11px] text-muted-foreground">{s.reference}</code> : null}
            </div>
            <p className="mt-1 text-sm">{s.rule}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Enforced by: {s.howEnforced}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}
