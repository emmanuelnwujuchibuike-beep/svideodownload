import { Check, Crown, Gem, Minus, Sparkles, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/layout/site-header";
import { UpgradeButton } from "@/features/monetization/upgrade-button";
import { getPricing } from "@/lib/monetization/pricing";
import { cn } from "@/lib/utils";

/*
 * Was `force-dynamic`, which made this public, header-linked page uncacheable on
 * every request. The only reason was `getPricing()` reading admin-managed prices —
 * but that goes through `createAdminClient` (service role, no cookies), so it is an
 * ISR case, not a dynamic one. Price edits now appear within the `revalidate`
 * window from app/layout.tsx instead of costing every visitor an origin render.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Pricing — Go ad-free with Pro",
  description:
    "Free forever, or upgrade to Pro for an ad-free experience, faster and batch downloads. Business adds full API access.",
  alternates: { canonical: "/pricing" },
};

interface Tier {
  id: string;
  name: string;
  price: string;
  period?: string;
  tagline: string;
  icon: typeof Sparkles;
  features: string[];
  cta: string;
  href: string;
  highlight?: boolean;
  prestige?: boolean;
}

/**
 * Feature copy — audited against the code, not carried forward from the last
 * pass (owner, 2026-08-26: "read all the pro and business features currently
 * and update the price plan features in pricing page").
 *
 * Every line below has a real mechanism behind it. Notably absent from the
 * previous version, verified as NOT gated by plan anywhere in the codebase:
 *
 *   - "4K & highest-quality downloads" as Pro-exclusive — quality itself is
 *     never plan-gated (server/extractors + the download service serve the
 *     same formats to everyone). What Pro actually removes is the reward ad
 *     Free watches in front of a top-tier or 100MB+ file
 *     (lib/monetization/reward-policy.ts) — that's the line below instead.
 *   - "Faster, priority downloads" — no download-speed or queue-priority
 *     differentiation exists anywhere in the pipeline.
 *   - "Priority support" (Business) — no priority flag/queue found in the
 *     support inbox or its admin surface.
 *   - "100% ad-free" as identical for Pro and Business — Pro still sees the
 *     download-history watch interstitial every 2nd video
 *     (features/monetization/download-interstitial.tsx: "Business never sees
 *     an interstitial... Pro sees only the watch trigger"). Only Business is
 *     unconditionally ad-free.
 *
 * Added, because it's real and wasn't listed: Creator analytics is an actual
 * Business-only gate (app/(app)/account/analytics/page.tsx: `plan !==
 * "business"` locks the whole page). Multi-Link batch numbers (3/2/ad vs.
 * 6/unlimited/no-ad) come straight from lib/downloads/multi-link-config.ts.
 * API request ceilings (50/500/50,000) come from
 * lib/monetization/plan.ts — access itself is universal (`/account/developer`
 * has no plan gate); only the daily ceiling differs, so this is billed as a
 * higher limit, never as "exclusive access."
 */
function buildTiers(pricing: {
  pro: { name: string; price: string; period: string };
  business: { name: string; price: string; period: string };
}): Tier[] {
  return [
    {
      id: "free",
      name: "Free",
      price: "$0",
      tagline: "Everything you need to get started.",
      icon: Sparkles,
      features: [
        "Save from every supported platform",
        "HD video, MP3 audio & photos — no watermark",
        "Batch downloads — up to 3 links, 2 a day, with a short ad",
        "150 downloads/day",
        "5 GB private cloud storage",
        "API access — 50 requests a day",
        "Supported by ads",
      ],
      cta: "Get started free",
      href: "/",
    },
    {
      id: "pro",
      name: pricing.pro.name,
      price: pricing.pro.price,
      period: pricing.pro.period,
      tagline: "For people who save a lot.",
      icon: Crown,
      features: [
        "Everything in Free",
        "No ads on downloads — skip the ad on large or top-quality files",
        "Batch downloads — up to 6 links, unlimited per day, no ad",
        "1,000 downloads/day",
        "50 GB private cloud storage",
        "API access — 500 requests a day",
      ],
      cta: `Upgrade to ${pricing.pro.name}`,
      href: "/login?next=/pricing",
      highlight: true,
    },
    {
      id: "business",
      name: pricing.business.name,
      price: pricing.business.price,
      period: pricing.business.period,
      tagline: "For creators & power users who want everything.",
      icon: Gem,
      features: [
        "Everything in Pro",
        // @sourced download-interstitial.tsx: `watchAllowed = plan !== "business"` — Business is the only plan gated on nothing, so 100% is literal, not rounded.
        "100% ad-free — every surface, including your download history",
        "Creator analytics — per-post views, engagement & audience growth",
        "10,000 downloads/day",
        "Unlimited private cloud storage",
        "API access — 50,000 requests a day, the highest limit",
      ],
      cta: `Get ${pricing.business.name}`,
      href: "/login?next=/pricing",
      prestige: true,
    },
  ];
}

/** The same facts as `buildTiers`, shaped for the comparison table instead of
 *  a bullet list — one grounded set of numbers, two presentations. */
type CompareValue = string | boolean;
interface CompareRow {
  label: string;
  free: CompareValue;
  pro: CompareValue;
  business: CompareValue;
}

function buildCompareRows(pricing: {
  pro: { price: string; period: string };
  business: { price: string; period: string };
}): CompareRow[] {
  return [
    {
      label: "Price",
      free: "$0",
      pro: `${pricing.pro.price}${pricing.pro.period}`,
      business: `${pricing.business.price}${pricing.business.period}`,
    },
    {
      label: "Saves per day",
      free: "150",
      pro: "1,000",
      business: "10,000",
    },
    {
      label: "Private cloud storage",
      free: "5 GB",
      pro: "50 GB",
      business: "Unlimited",
    },
    { label: "Batch links per save", free: "3", pro: "6", business: "6" },
    {
      label: "Batch saves per day",
      free: "2",
      pro: "Unlimited",
      business: "Unlimited",
    },
    {
      label: "Ad before large/top-quality saves",
      free: true,
      pro: false,
      business: false,
    },
    {
      label: "Ads anywhere in the app",
      free: true,
      pro: true,
      business: false,
    },
    {
      label: "API requests per day",
      free: "50",
      pro: "500",
      business: "50,000",
    },
    { label: "Creator analytics", free: false, pro: false, business: true },
  ];
}

function CompareCell({ value }: { value: CompareValue }) {
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-3.5 w-3.5" />
      </span>
    ) : (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-muted-foreground/50">
        <Minus className="h-3.5 w-3.5" />
      </span>
    );
  }
  return <span className="font-semibold tabular-nums">{value}</span>;
}

export default async function PricingPage() {
  const pricing = await getPricing();
  const TIERS = buildTiers(pricing);
  const COMPARE = buildCompareRows(pricing);

  return (
    <>
      <SiteHeader />
      <main className="relative overflow-hidden pb-28 pt-[calc(var(--frenz-safe-top)+8rem)] sm:pt-[calc(var(--frenz-safe-top)+10rem)]">
        <div className="container max-w-5xl">
          <header className="mx-auto mb-14 max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Zap className="h-3.5 w-3.5" /> Simple pricing
            </span>
            <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em] sm:text-4xl lg:text-5xl">
              Simple, honest pricing
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Start free. Upgrade any time to remove ads, download faster, or
              build on our API. Cancel whenever you like.
            </p>
          </header>

          <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
            {TIERS.map((t) => (
              <div
                key={t.id}
                id={t.id}
                className={cn(
                  "relative flex flex-col scroll-mt-24 rounded-3xl p-7 transition-all",
                  t.prestige
                    ? "border border-amber-300/40 bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white shadow-luxury ring-1 ring-amber-300/30 lg:z-10 lg:scale-[1.06] lg:-translate-y-1"
                    : t.highlight
                      ? "border border-amber-500/30 bg-card bg-gradient-to-b from-amber-500/[0.08] to-transparent shadow-card ring-1 ring-amber-500/15 lg:scale-[1.02]"
                      : "border border-border/80 bg-card shadow-card",
                )}
              >
                {t.prestige ? (
                  <>
                    {/* Soft platinum sheen across the top of the prestige card */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 h-32 rounded-t-3xl bg-gradient-to-b from-amber-200/10 to-transparent"
                    />
                    <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-900 shadow-lg shadow-amber-400/40 ring-1 ring-amber-100/50">
                      <Crown className="h-3.5 w-3.5" /> Ultimate
                    </span>
                  </>
                ) : t.highlight ? (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-amber-500/30">
                    Most popular
                  </span>
                ) : null}

                {/* Icon + name */}
                <div className="mb-5 flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl shadow-sm",
                      t.prestige
                        ? "bg-gradient-to-br from-amber-200 via-amber-400 to-amber-500 text-slate-900 shadow-amber-400/40 ring-1 ring-amber-200/40"
                        : t.highlight
                          ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/30"
                          : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <t.icon className="h-5 w-5" />
                  </span>
                  <h2 className="text-lg font-bold">{t.name}</h2>
                </div>

                {/* Price */}
                <div className="mb-2 flex items-end gap-1.5">
                  <span
                    className={cn(
                      "text-5xl font-bold tracking-tight",
                      (t.highlight || t.prestige) && "text-gradient-gold",
                    )}
                  >
                    {t.price}
                  </span>
                  {t.period ? (
                    <span
                      className={cn(
                        "mb-1.5 text-sm",
                        t.prestige ? "text-slate-400" : "text-muted-foreground",
                      )}
                    >
                      {t.period}
                    </span>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "mb-6 text-sm",
                    t.prestige ? "text-slate-400" : "text-muted-foreground",
                  )}
                >
                  {t.tagline}
                </p>

                {/* Features */}
                <ul className="mb-8 space-y-3">
                  {t.features.map((f) => (
                    <li
                      key={f}
                      className={cn(
                        "flex items-start gap-2.5 text-sm",
                        t.prestige && "text-slate-200",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                          t.prestige
                            ? "bg-amber-400/20 text-amber-300"
                            : t.highlight
                              ? "bg-amber-500/15 text-amber-500"
                              : "bg-primary/10 text-primary",
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {t.id === "pro" || t.id === "business" ? (
                  <div className="mt-auto">
                    <UpgradeButton
                      plan={t.id}
                      className={cn(
                        "group relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all active:scale-[0.99] disabled:opacity-70",
                        t.prestige
                          ? "bg-gradient-to-r from-amber-200 via-amber-400 to-amber-300 text-slate-900 shadow-lg shadow-amber-400/30 hover:shadow-amber-400/50 hover:shadow-xl"
                          : t.highlight
                            ? "bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:shadow-xl"
                            : "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:shadow-primary/35",
                      )}
                    >
                      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                      {t.cta}
                    </UpgradeButton>
                  </div>
                ) : (
                  <Link
                    href={t.href}
                    className="mt-auto inline-flex items-center justify-center rounded-2xl border border-border/80 bg-background/60 px-4 py-3.5 text-sm font-semibold transition hover:bg-secondary active:scale-[0.99]"
                  >
                    {t.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>

          {/*
            Full comparison table — the same grounded numbers as the cards
            above, in a scannable side-by-side. Added because the card copy
            got MORE specific this pass (exact daily/API/batch ceilings per
            plan), and specific numbers are easier to compare in a grid than
            to re-read across three lists. `overflow-x-auto` on its own
            wrapper: a 4-column table must never widen the page itself.
          */}
          <section className="mt-16">
            <h2 className="mb-5 text-center text-xl font-bold tracking-tight sm:text-2xl">
              Compare every plan
            </h2>
            {/*
              A 560px table on a ~375px phone MUST scroll — but scrolling
              off a hard-edged card reads as "this is cut off," not "swipe for
              more" (caught on a mobile screenshot: the Pro/Business columns
              simply vanished past the card's own border with no cue). The
              fade is the cue, `sm:hidden` because desktop already shows the
              whole table with room to spare. `pointer-events-none` so it
              never blocks the actual horizontal scroll it's hinting at.
            */}
            <div className="relative">
              <div className="overflow-x-auto rounded-3xl border border-border/80 bg-card shadow-card">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th
                        scope="col"
                        className="p-4 text-left font-semibold text-muted-foreground"
                      >
                        &nbsp;
                      </th>
                      <th scope="col" className="p-4 text-center font-bold">
                        Free
                      </th>
                      <th
                        scope="col"
                        className="p-4 text-center font-bold text-amber-600 dark:text-amber-400"
                      >
                        {pricing.pro.name}
                      </th>
                      <th
                        scope="col"
                        className="p-4 text-center font-bold text-amber-600 dark:text-amber-400"
                      >
                        {pricing.business.name}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE.map((row, i) => (
                      <tr
                        key={row.label}
                        className={cn(i > 0 && "border-t border-border/40")}
                      >
                        <th
                          scope="row"
                          className="p-4 text-left font-medium text-muted-foreground"
                        >
                          {row.label}
                        </th>
                        <td className="p-4 text-center">
                          <CompareCell value={row.free} />
                        </td>
                        <td className="bg-amber-500/[0.04] p-4 text-center">
                          <CompareCell value={row.pro} />
                        </td>
                        <td className="bg-amber-500/[0.07] p-4 text-center">
                          <CompareCell value={row.business} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-3xl bg-gradient-to-l from-card to-transparent sm:hidden"
              />
            </div>
          </section>

          <p className="mx-auto mt-12 max-w-xl text-center text-xs text-muted-foreground/70">
            Prices in USD. Taxes may apply. Subscriptions renew automatically
            and can be canceled any time from your account.
          </p>
        </div>
      </main>
    </>
  );
}
