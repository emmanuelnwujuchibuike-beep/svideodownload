import type { CertStatus } from "@/lib/platform/certification";
import type { TestType } from "@/lib/platform/test-types";
import { cn } from "@/lib/utils";

/**
 * The Quality catalogue — production-readiness at a glance. Certifications are
 * COMPUTED from the real governance gates (not granted), so a `gap` here means a
 * backing gate is only planned. Read-only; no client JS.
 */

const READINESS: Record<string, { label: string; className: string }> = {
  automated: { label: "automated", className: "bg-green-500/15 text-green-500" },
  attested: { label: "needs attestation", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  gap: { label: "gap", className: "bg-red-500/15 text-red-500" },
};

const TEST_STATUS: Record<string, string> = {
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

export function QualityCatalog({
  certifications,
  testTypes,
}: {
  certifications: CertStatus[];
  testTypes: TestType[];
}) {
  const liveTests = testTypes.filter((t) => t.status === "live").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Quality as a platform capability. Certifications are <strong>computed</strong> from the
        governance gates — a certification can&apos;t be claimed while a gate it depends on is only
        planned, so the picture below is honest by construction.
      </p>

      <Card title={`Certifications · ${certifications.length}`} blurb="automated = fully machine-enforced · needs attestation = a human signs off a manual gate · gap = a backing gate is still planned.">
        {certifications.map(({ cert, readiness, automated, manual, planned }) => {
          const r = READINESS[readiness] ?? { label: "gap", className: "bg-red-500/15 text-red-500" };
          return (
            <div key={cert.id} className="border-b border-border/40 pb-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{cert.name}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", r.className)}>
                  {r.label}
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  {automated} automated · {manual} manual · {planned} planned
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{cert.description}</p>
            </div>
          );
        })}
      </Card>

      <Card title={`Test types · ${liveTests}/${testTypes.length} live`} blurb="What the platform tests automatically, and what's decided-but-planned. No fake suites.">
        {testTypes.map((t) => (
          <div key={t.id} className="border-b border-border/40 pb-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", TEST_STATUS[t.status] ?? TEST_STATUS.planned)}>
                {t.status}
              </span>
              {t.harness ? <code className="font-mono text-[11px] text-muted-foreground">{t.harness}</code> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t.scope}</p>
            {t.note ? <p className="mt-0.5 text-[11px] italic text-muted-foreground/70">{t.note}</p> : null}
          </div>
        ))}
      </Card>
    </div>
  );
}
