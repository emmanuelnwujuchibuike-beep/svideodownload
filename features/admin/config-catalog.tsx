import type { ConfigChange } from "@/lib/platform/config-audit";
import type { ConfigSurface } from "@/lib/platform/config-registry";
import { cn } from "@/lib/utils";

/**
 * The Configuration catalogue — what can change WITHOUT a release, and a live log of
 * what HAS changed (with actor + before→after, the rollback source). Read-only; the
 * surfaces come from the code registry, the history from `config_audit_log`.
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

function summarize(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined);
    if (entries.length === 0) return "cleared";
    return entries.map(([k, v]) => `${k}=${v}`).join(", ");
  }
  return String(value);
}

export function ConfigCatalog({
  surfaces,
  changes,
}: {
  surfaces: ConfigSurface[];
  changes: ConfigChange[];
}) {
  const live = surfaces.filter((s) => s.status === "live").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Everything that evolves without a redeploy, in one place — and every change recorded.
        Approval workflow and geo/device targeting are honestly <em>planned</em>; changes today are
        audited and reversible.
      </p>

      <Card title={`Config surfaces · ${live}/${surfaces.length} live`} blurb="What's runtime-configurable, where its value lives, and at what scope.">
        {surfaces.map((s) => (
          <div key={s.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[s.status] ?? STATUS.planned)}>
                {s.status}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{s.kind} · {s.scope}</span>
              {s.source ? <code className="font-mono text-[11px] text-muted-foreground">{s.source}</code> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.governs}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">storage: {s.storage || "—"}{s.note ? ` · ${s.note}` : ""}</p>
          </div>
        ))}
      </Card>

      <Card title="Change history" blurb="Every flag/experiment change — who, when, and before → after. This is the rollback source.">
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No config changes recorded yet. Flip a flag or pause an experiment and it appears here
            (needs migration 0093 applied).
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {changes.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{c.surface}</span>
                  <code className="font-mono text-xs">{c.targetId}</code>
                  <span className="text-xs text-muted-foreground">{c.action}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">{new Date(c.at).toLocaleString()}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {summarize(c.before)} <span className="text-muted-foreground/50">→</span> {summarize(c.after)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
