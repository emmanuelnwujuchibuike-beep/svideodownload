import { Ban, Database, Lock } from "lucide-react";

import { DATA_DOMAINS } from "@/lib/platform/data-domains";
import { PORTABILITY } from "@/lib/portability/registry";
import { exportPlan, SECRET_TABLES } from "@/lib/portability/tables";

/**
 * Data Transparency Dashboard™ — Feature 18 · Part 24.
 *
 * ── Why this is a server component with no data fetch ────────────────────────
 * It answers "what does Frenz store about me, and why" — and that answer is the
 * same for everybody. It is a property of the SCHEMA, not of one account. So it
 * renders from the registry at build/request time with no query, no loading
 * state and no client JavaScript, and it is correct for a signed-out reader
 * deciding whether to sign up in the first place.
 *
 * The counts shown are the real number of tables in each domain, derived from
 * the same catalogue the export reads. Nothing here can claim coverage the
 * export does not actually have — they are the same source.
 */
export function DataTransparency() {
  const plan = exportPlan();
  const included = new Set(plan.included.map((t) => t.table));

  const groups = PORTABILITY.map((spec) => {
    const domain = DATA_DOMAINS.find((d) => d.id === spec.domain);
    if (!domain) return null;
    const exported = domain.tables.filter((t) => included.has(t)).length;
    return { spec, domain, exported };
  }).filter((g): g is NonNullable<typeof g> => g !== null);

  const personal = groups.filter((g) => g.spec.dataClass === "personal");
  const restricted = groups.filter((g) => g.spec.dataClass === "restricted");
  const operational = groups.filter((g) => g.spec.dataClass === "operational");

  return (
    <div className="space-y-7">
      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Yours, and downloadable
        </h2>
        <p className="mb-2 px-1 text-xs text-muted-foreground">
          {plan.included.length} sets of records, included in full when you download your data.
        </p>
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/60">
          {personal.map(({ spec, domain, exported }) => (
            <Row key={spec.domain} title={domain.name} count={`${exported} included`} icon={<Database className="h-4 w-4" />}>
              <Detail label="What it is" value={spec.holds} />
              <Detail label="Why we have it" value={spec.purpose} />
              <Detail label="How long we keep it" value={spec.retention} />
            </Row>
          ))}
        </div>
      </section>

      {/*
        The section most privacy pages leave out. Saying "we hold this and we
        will not hand it over in bulk, and here is exactly why" is more
        trustworthy than a page that only lists the easy parts — and every
        reason here is required in writing by a test, so it cannot decay into
        "for security reasons".
      */}
      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Yours, but not downloadable in bulk
        </h2>
        <p className="mb-2 px-1 text-xs leading-relaxed text-muted-foreground">
          These are about you, and we will not put them in a single downloadable file. Each reason is below.
        </p>
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/60">
          {restricted.map(({ spec, domain }) => (
            <Row key={spec.domain} title={domain.name} count="Withheld" icon={<Ban className="h-4 w-4" />}>
              <Detail label="What it is" value={spec.holds} />
              <Detail label="Why it is not in the download" value={spec.withheldBecause ?? ""} />
              <Detail label="How long we keep it" value={spec.retention} />
            </Row>
          ))}
        </div>
      </section>

      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Never leaves our servers
        </h2>
        <p className="mb-2 px-1 text-xs leading-relaxed text-muted-foreground">
          Security material. It is yours, and putting it in a file you download would make your account less safe, not
          more.
        </p>
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/60">
          {Object.entries(SECRET_TABLES).map(([table, reason]) => (
            <div key={table} className="flex items-start gap-3 px-3.5 py-3">
              <span className="mt-0.5 text-muted-foreground">
                <Lock className="h-4 w-4" />
              </span>
              <p className="text-xs leading-relaxed text-muted-foreground">{reason}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Not about you
        </h2>
        <p className="mb-2 px-1 text-xs text-muted-foreground">
          Records that run the product and contain nothing personal.
        </p>
        <ul className="flex flex-wrap gap-1.5 px-1">
          {operational.map(({ domain }) => (
            <li key={domain.id} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {domain.name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    /* A native <details>: the answers are in the document whether or not it is
       open — which matters for in-page find and for a screen reader — and it
       needs no state, no library and no hydration. */
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 text-sm font-semibold">{title}</span>
        <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{count}</span>
      </summary>
      <div className="space-y-2 px-3.5 pb-4 pl-[3.4rem]">{children}</div>
    </details>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      <span className="font-semibold text-foreground">{label}: </span>
      {value}
    </p>
  );
}
