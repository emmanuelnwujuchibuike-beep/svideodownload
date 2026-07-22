import type { ColorToken } from "@/lib/platform/design-tokens";
import type { ComponentCategory, ComponentDef } from "@/lib/platform/component-registry";
import type { A11yStandard, DesignPrinciple, MotionPattern, ThemeDef } from "@/lib/platform/design-system";
import { cn } from "@/lib/utils";

/**
 * The Design System catalogue — the Enterprise Design System described by itself.
 *
 * Read-only, and sourced entirely from code registries: components + their a11y
 * and motion contracts from `component-registry.ts`, principles/motion/themes
 * from `design-system.ts`, colours from `design-tokens.ts`. Adoption numbers are
 * deliberately NOT shown here — they need a source-tree scan that isn't available
 * at request time — so `npm run design:adoption` is named as the honest way to
 * measure them, rather than printing a fabricated figure.
 */

const STATUS: Record<string, string> = {
  live: "bg-green-500/15 text-green-500",
  convention: "bg-blue-500/15 text-blue-500",
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

export function DesignCatalog({
  components,
  categories,
  principles,
  motionPatterns,
  a11yStandards,
  themes,
  colorTokens,
  brandTokens,
}: {
  components: ComponentDef[];
  categories: { id: ComponentCategory; label: string }[];
  principles: DesignPrinciple[];
  motionPatterns: MotionPattern[];
  a11yStandards: A11yStandard[];
  themes: ThemeDef[];
  colorTokens: ColorToken[];
  brandTokens: ColorToken[];
}) {
  const live = components.filter((c) => c.status === "live").length;
  const convention = components.filter((c) => c.status === "convention").length;
  const planned = components.filter((c) => c.status === "planned").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The Experience OS described by itself: {colorTokens.length + brandTokens.length} colour tokens
        generated into the CSS, {components.length} catalogued components ({live} live · {convention}{" "}
        convention · {planned} planned), each with an accessibility and motion contract. Adoption is
        measured by <code className="font-mono text-[11px]">npm run design:adoption</code>.
      </p>

      <Card title="Design principles" blurb="What every surface is measured against.">
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {principles.map((p) => (
            <li key={p.id} className="rounded-xl bg-secondary/40 p-3">
              <p className="text-sm font-semibold">{p.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Component registry · ${components.length}`} blurb="Every reusable building block, its source, and its accessibility + motion contract.">
        {categories.map((cat) => {
          const inCat = components.filter((c) => c.category === cat.id);
          if (inCat.length === 0) return null;
          return (
            <div key={cat.id} className="border-b border-border/40 pb-3 last:border-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{cat.label}</p>
              <div className="mt-1.5 space-y-2">
                {inCat.map((c) => (
                  <div key={c.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[c.status] ?? STATUS.planned)}>
                        {c.status}
                      </span>
                      {c.source ? <code className="font-mono text-[11px] text-muted-foreground">{c.source}</code> : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/70">a11y:</span> {c.a11y}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/70">motion:</span> {c.motion}
                    </p>
                    {c.note ? <p className="text-[11px] text-muted-foreground/70">{c.note}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Motion language" blurb="Every animation pattern and how it honours reduced motion.">
          {motionPatterns.map((m) => (
            <div key={m.id} className="border-b border-border/40 pb-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                {m.source ? <code className="font-mono text-[11px] text-muted-foreground">{m.source}</code> : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{m.purpose}</p>
              <p className="text-[11px] text-muted-foreground/70">token: {m.token}</p>
              <p className="text-[11px] text-muted-foreground/70">reduced-motion: {m.reducedMotion}</p>
            </div>
          ))}
        </Card>

        <div className="space-y-5">
          <Card title="Accessibility standards" blurb="The contract, and how it's enforced.">
            {a11yStandards.map((s) => (
              <div key={s.id} className="border-b border-border/40 pb-2.5 last:border-0">
                <p className="text-sm font-medium">{s.requirement}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.howEnforced}</p>
              </div>
            ))}
          </Card>

          <Card title="Themes" blurb="Light is the default; the token architecture is theme-ready.">
            {themes.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2 last:border-0">
                <span className="text-sm font-medium">{t.name}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS[t.status] ?? STATUS.planned)}>
                  {t.status}
                </span>
                <span className="w-full text-[11px] text-muted-foreground">{t.note}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
