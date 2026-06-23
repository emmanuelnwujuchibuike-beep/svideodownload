import { Check, Code2, Crown, Sparkles } from "lucide-react";
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
      cta: "Get started",
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
      <main className="container max-w-5xl pb-24 pt-28 sm:pt-36">
        <header className="mx-auto mb-12 max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
            Simple, honest pricing
          </h1>
          <p className="mt-3 text-muted-foreground">
            Start free. Upgrade any time to remove ads, download faster, or build
            on our API. Cancel whenever you like.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.id}
              id={t.id}
              className={cn(
                "relative flex flex-col scroll-mt-24 rounded-3xl border bg-card p-6 shadow-soft",
                t.highlight
                  ? "border-primary/40 ring-1 ring-primary/20 lg:scale-[1.03]"
                  : "border-border",
              )}
            >
              {t.highlight ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow">
                  Most popular
                </span>
              ) : null}
              <div className="mb-4 flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl",
                    t.highlight ? "bg-primary/15 text-primary" : "bg-secondary text-foreground",
                  )}
                >
                  <t.icon className="h-5 w-5" />
                </span>
                <h2 className="text-lg font-semibold">{t.name}</h2>
              </div>
              <div className="mb-1 flex items-end gap-1">
                <span className="text-4xl font-bold tracking-tight">{t.price}</span>
                {t.period ? (
                  <span className="mb-1 text-sm text-muted-foreground">{t.period}</span>
                ) : null}
              </div>
              <p className="mb-5 text-sm text-muted-foreground">{t.tagline}</p>

              <ul className="mb-6 space-y-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {t.id === "pro" || t.id === "business" ? (
                <div className="mt-auto">
                  <UpgradeButton
                    plan={t.id}
                    className={cn(
                      "inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-70",
                      t.highlight
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40"
                        : "border border-border bg-background hover:bg-secondary",
                    )}
                  >
                    {t.cta}
                  </UpgradeButton>
                </div>
              ) : (
                <Link
                  href={t.href}
                  className={cn(
                    "mt-auto inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.99]",
                    "border border-border bg-background hover:bg-secondary",
                  )}
                >
                  {t.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-xl text-center text-xs text-muted-foreground">
          Prices in USD. Taxes may apply. Subscriptions renew automatically and can
          be canceled any time from your account.
        </p>
      </main>
    </>
  );
}
