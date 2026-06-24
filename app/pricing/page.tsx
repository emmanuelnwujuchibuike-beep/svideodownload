import { Check, Code2, Crown, Sparkles, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/layout/site-header";
import { UpgradeButton } from "@/features/monetization/upgrade-button";
import { getPricing } from "@/lib/monetization/pricing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
        "Faster, priority downloads",
        "Batch downloads",
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
        "Full REST API access",
        "10,000 downloads/day",
        "Higher rate limits",
        "Priority support",
      ],
      cta: `Get ${pricing.business.name}`,
      href: "/login?next=/pricing",
    },
  ];
}

export default async function PricingPage() {
  const TIERS = buildTiers(await getPricing());
  return (
    <>
      <SiteHeader />
      <main className="relative overflow-hidden pb-28 pt-32 sm:pt-40">
        {/* Gold glow — top center */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/16 via-orange-500/8 to-transparent blur-[90px]"
        />
        {/* Blue glow — top right (business tier side) */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[5%] top-[8%] -z-10 h-[240px] w-[320px] rounded-full bg-gradient-to-bl from-blue-600/12 via-sky-500/8 to-transparent blur-[70px]"
        />
        {/* Cyan glow — bottom left */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-[8%] -z-10 h-[180px] w-[280px] rounded-full bg-gradient-to-tr from-cyan-500/10 to-transparent blur-[65px]"
        />

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
                  "relative flex flex-col scroll-mt-24 rounded-3xl p-7",
                  t.highlight
                    ? "border border-amber-500/30 bg-card bg-gradient-to-b from-amber-500/[0.08] to-transparent shadow-card ring-1 ring-amber-500/15 lg:scale-[1.04]"
                    : "border border-border/80 bg-card shadow-card",
                )}
              >
                {t.highlight ? (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-amber-500/30">
                    Most popular
                  </span>
                ) : null}

                {/* Icon + name */}
                <div className="mb-5 flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl shadow-sm",
                      t.highlight
                        ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/30"
                        : t.id === "business"
                          ? "bg-gradient-to-br from-blue-600 to-cyan-400 text-white shadow-blue-500/25"
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
                      t.highlight && "text-gradient-gold",
                    )}
                  >
                    {t.price}
                  </span>
                  {t.period ? (
                    <span className="mb-1.5 text-sm text-muted-foreground">{t.period}</span>
                  ) : null}
                </div>
                <p className="mb-6 text-sm text-muted-foreground">{t.tagline}</p>

                {/* Features */}
                <ul className="mb-8 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                          t.highlight
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
                        t.highlight
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
