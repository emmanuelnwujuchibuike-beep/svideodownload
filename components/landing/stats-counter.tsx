import { Layers, ShieldOff, Tag, Unlock } from "lucide-react";

import { PLATFORMS, SHOWCASE_PLATFORMS } from "@/lib/platforms";

/**
 * The landing proof band.
 *
 * HISTORY — this component previously animated four fabricated numbers on scroll:
 * "35,000,000+ Videos Downloaded", "8,000,000+ Community Members", "120+ Countries"
 * and a "99.9% Success Rate". Measured against the database on 2026-07-18, all four
 * were overstated by four to five orders of magnitude. The count-up animation made
 * them read as live telemetry, which compounded it.
 *
 * There is no honest way to present scale at this stage, so we don't. Every figure
 * below is instead DERIVED from the product itself and is therefore true by
 * construction — it cannot drift, and it re-states itself automatically as the
 * product grows. Specific, verifiable claims also read as more credible than round
 * invented millions, which is the substantive argument for this version, not just
 * the ethical one.
 *
 * Enforced by `lib/content/reality-ledger.test.ts`. If you are about to add a
 * hardcoded number here, that test will fail, and it is right.
 *
 * Perf note: this is now a SERVER component. The old version shipped an
 * IntersectionObserver plus a requestAnimationFrame loop per stat to `/`, which is
 * a static page under a 2-second cold-entry budget with known LCP pressure. The
 * honest version is also the cheaper one — zero client JS.
 */

/** Platforms with genuine watermark-free extraction, per the platform registry. */
const WATERMARK_FREE = Object.values(PLATFORMS).filter((p) => p.watermarkFree).length;

interface Proof {
  icon: typeof Layers;
  value: string;
  label: string;
}

const PROOF: Proof[] = [
  // @sourced — SHOWCASE_PLATFORMS, lib/platforms.ts (named platforms, excludes `generic`).
  { icon: Layers, value: String(SHOWCASE_PLATFORMS.length), label: "Platforms supported" },
  // @sourced — PLATFORMS[].watermarkFree, lib/platforms.ts.
  { icon: ShieldOff, value: String(WATERMARK_FREE), label: "Watermark-free sources" },
  // @sourced — the Free tier in app/(marketing)/pricing/page.tsx.
  { icon: Tag, value: "Free", label: "Forever, with no trial" },
  // @sourced — /api/download gates worker calls only; no user session required.
  { icon: Unlock, value: "None", label: "Account needed to start" },
];

export function StatsCounter() {
  return (
    <section className="container max-w-6xl py-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-900 p-8 shadow-elevated sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl" />
        <dl className="relative grid grid-cols-2 gap-6 sm:grid-cols-4">
          {PROOF.map(({ icon: Icon, value, label }) => (
            <div key={label} className="flex items-center gap-3 text-white">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-violet-300 ring-1 ring-white/10">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <dd className="text-2xl font-extrabold tabular-nums sm:text-3xl">{value}</dd>
                <dt className="text-xs text-white/60">{label}</dt>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
