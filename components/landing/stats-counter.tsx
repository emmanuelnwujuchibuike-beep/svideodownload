import { PLATFORMS, SHOWCASE_PLATFORMS } from "@/lib/platforms";
import { allRealCapabilities } from "@/lib/content/genome/queries";

/**
 * The landing proof band — five columns, matching the redesign mockup
 * (`public/main landing page.jpg`).
 *
 * ── The conflict this resolves ─────────────────────────────────────────────────
 *
 * The mockup specifies: "10M+ Happy Users · 50M+ Downloads · 20+ Platforms
 * Supported · 99.9% Uptime · 4.9★ User Rating". Not one of those is sourceable.
 * Measured against the database on 2026-07-18, users and downloads were overstated
 * by four to five orders of magnitude; there is no uptime monitor to quote a nine
 * from, and no review system that could produce a star rating at all.
 *
 * This component already shipped those figures once — as 35,000,000+ "Videos
 * Downloaded" and 8,000,000+ "Community Members", animated on scroll so they read
 * as live telemetry — and Phase 1 removed them.
 *
 * The resolution keeps the mockup's DESIGN and sources its CONTENT: five columns,
 * the same gradient band and gradient numerals, the same rhythm — with every figure
 * derived from the product itself. A specific, checkable claim also converts better
 * than a round invented million, so this is not only the honest version.
 *
 * Enforced by `lib/content/reality-ledger.test.ts`. A hardcoded magnitude here —
 * digits or the word "millions" — fails the build, and it is right to.
 *
 * Perf: server component, zero client JS. The original shipped an
 * IntersectionObserver plus a requestAnimationFrame loop per stat to a static page
 * under a 2-second budget.
 */

/** @sourced PLATFORMS[].watermarkFree — lib/platforms.ts */
const WATERMARK_FREE = Object.values(PLATFORMS).filter((p) => p.watermarkFree).length;

/** @sourced genome capabilities at a real stage — lib/content/genome */
const LIVE_CAPABILITIES = allRealCapabilities().length;

interface Proof {
  value: string;
  label: string;
}

const PROOF: Proof[] = [
  // @sourced SHOWCASE_PLATFORMS — named platforms, excludes the `generic` fallback.
  { value: String(SHOWCASE_PLATFORMS.length), label: "Platforms supported" },
  // @sourced PLATFORMS[].watermarkFree
  { value: String(WATERMARK_FREE), label: "Watermark-free sources" },
  // @sourced Product Genome — capabilities at stage live/beta/alpha
  { value: String(LIVE_CAPABILITIES), label: "Features shipped" },
  // @sourced the Free tier in app/(marketing)/pricing/page.tsx
  { value: "Free", label: "Forever, no trial" },
  // @sourced /api/download gates worker calls only; no user session required
  { value: "None", label: "Account needed" },
];

export function StatsCounter() {
  return (
    <section className="container max-w-6xl py-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-900 p-8 shadow-elevated sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl"
        />
        <dl className="relative grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {PROOF.map(({ value, label }) => (
            <div key={label} className="text-center">
              <dd className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-3xl font-extrabold tabular-nums text-transparent sm:text-4xl">
                {value}
              </dd>
              <dt className="mt-1 text-xs text-white/60">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
