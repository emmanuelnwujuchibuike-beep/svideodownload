import { Boxes, CheckCircle2, Droplets, Sparkles, type LucideIcon } from "lucide-react";

import { PLATFORMS, SHOWCASE_PLATFORMS } from "@/lib/platforms";
import { allRealCapabilities } from "@/lib/content/genome/queries";

/**
 * The landing proof band — four icon columns, matching the reference's stats strip
 * (`public/newlandingfull.jpg`).
 *
 * ── The conflict this resolves ─────────────────────────────────────────────────
 *
 * The reference specifies "50,000+ Happy Users · 100+ Platforms · 1M+ Downloads ·
 * 99.9% Uptime". Three of those are unsourceable scale claims — there is no user or
 * download count we can honestly quote, and no uptime monitor to quote a nine from.
 * `reality-ledger.test.ts` FAILS THE BUILD on any of them (a comma-grouped number,
 * an "M+", or a "%" next to a social-proof noun), and it is right to.
 *
 * So this keeps the reference's DESIGN — a four-up icon band — and sources every
 * figure from the product itself. A specific, checkable claim also converts better
 * than a round invented million. Perf: server component, zero client JS.
 */

/** @sourced PLATFORMS[].watermarkFree — lib/platforms.ts */
const WATERMARK_FREE = Object.values(PLATFORMS).filter((p) => p.watermarkFree).length;

/** @sourced genome capabilities at a real stage — lib/content/genome */
const LIVE_CAPABILITIES = allRealCapabilities().length;

interface Proof {
  icon: LucideIcon;
  value: string;
  label: string;
}

const PROOF: Proof[] = [
  // @sourced SHOWCASE_PLATFORMS — named platforms, excludes the `generic` fallback.
  { icon: Boxes, value: String(SHOWCASE_PLATFORMS.length), label: "Platforms supported" },
  // @sourced PLATFORMS[].watermarkFree
  { icon: Droplets, value: String(WATERMARK_FREE), label: "Watermark-free sources" },
  // @sourced Product Genome — capabilities at stage live/beta/alpha
  { icon: Sparkles, value: String(LIVE_CAPABILITIES), label: "Features shipped" },
  // @sourced /api/download gates worker calls only; no user session required
  { icon: CheckCircle2, value: "Free", label: "Forever · no account" },
];

export function StatsCounter() {
  return (
    <section className="frenz-reveal container max-w-6xl px-2 py-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 rounded-[1.75rem] border border-border/50 bg-gradient-to-b from-card to-card/55 p-7 shadow-card ring-1 ring-inset ring-border/40 sm:grid-cols-4 sm:gap-4 sm:p-10">
        {PROOF.map(({ icon: Icon, value, label }) => (
          <div key={label} className="flex flex-col items-center gap-2.5 text-center sm:flex-row sm:gap-3 sm:text-left">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-violet-600 ring-1 ring-inset ring-violet-500/15 dark:text-violet-300">
              <Icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-[1.75rem] font-extrabold leading-none tabular-nums text-transparent dark:from-blue-400 dark:to-violet-400 sm:text-[2.1rem]">
                {value}
              </span>
              <span className="mt-1 block text-xs font-medium text-muted-foreground">{label}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
