import { Check, Code2, Crown, Sparkles, Zap } from "lucide-react";
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
        "Downloads from every supported platform",
        "HD video, MP3 audio & photos",
        "No watermark",
        "5 GB private cloud storage",
        "Up to 30 downloads/day",
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
      tagline: "For people who download a lot.",
      icon: Crown,
      features: [
        "Everything in Free",
        "100% ad-free experience",
        "50 GB private cloud storage",
        "4K & highest-quality downloads",
        "Faster, priority downloads",
        "Batch downloads",
        "Watch & re-download on any device",
        "Up to 1,000 downloads/day",
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
      tagline: "For developers & power users.",
      icon: Code2,
      features: [
        "Everything in Pro",
        "Unlimited private cloud storage",
        "Full REST API access",
        "10,000 downloads/day",
        "Higher rate limits",
        "Priority support",
      ],
      cta: `Get ${pricing.business.name}`,
      href: "/login?next=/pricing",
      prestige: true,
    },
  ];
}

export default async function PricingPage() {
  const TIERS = buildTiers(await getPricing());
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

          <p className="mx-auto mt-12 max-w-xl text-center text-xs text-muted-foreground/70">
            Prices in USD. Taxes may apply. Subscriptions renew automatically and can
            be canceled any time from your account.
          </p>
        </div>
      </main>
    </>
  );
}
