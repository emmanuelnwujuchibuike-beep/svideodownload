"use client";

import { ArrowRight, Code2, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { RevenueStrategy } from "@/lib/monetization/types";

import { AdSlot } from "./ad-slot";

/**
 * Renders whatever the server-side decision engine chose for this visit:
 * an affiliate CTA, an ad fill, a Pro upgrade nudge, or an API upsell.
 * Premium users get `{ type: "none" }` → renders nothing.
 */
export function ResultOffer() {
  const [strategy, setStrategy] = useState<RevenueStrategy | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/monetization/strategy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.strategy) setStrategy(d.strategy as RevenueStrategy);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!strategy || strategy.type === "none") return null;

  if (strategy.type === "ad") {
    return <AdSlot zone="download_result_page" className="mx-auto mt-6 w-full max-w-2xl" />;
  }

  if (strategy.type === "affiliate") {
    const o = strategy.offer;
    return (
      <a
        href={`/api/go/${o.id}`}
        target="_blank"
        rel="nofollow sponsored noopener"
        className="group mx-auto mt-6 flex w-full max-w-2xl items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:border-primary/40 hover:shadow-card"
      >
        {o.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{o.name}</p>
          {o.description ? (
            <p className="truncate text-xs text-muted-foreground">{o.description}</p>
          ) : null}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition group-hover:gap-1.5">
          {o.cta} <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </a>
    );
  }

  if (strategy.type === "api_upsell") {
    return (
      <UpsellCard
        icon={<Code2 className="h-6 w-6" />}
        title="Build with our API"
        body="Automate downloads at scale — 50 free calls/day, then pay as you grow."
        href="/pricing#business"
        cta="View API plans"
      />
    );
  }

  // premium_prompt
  return (
    <UpsellCard
      icon={<Zap className="h-6 w-6" />}
      title="Tired of ads?"
      body="Go Pro for an ad-free experience, faster downloads and batch saving."
      href="/pricing"
      cta="Upgrade to Pro"
    />
  );
}

function UpsellCard({
  icon,
  title,
  body,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-2xl items-center gap-4 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] to-transparent p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
      >
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
