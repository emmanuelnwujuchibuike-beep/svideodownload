"use client";

import { ArrowRight, Code2, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { RevenueStrategy } from "@/lib/monetization/types";
import { upgradeCta, upgradeHeadline } from "@/lib/monetization/upgrade-cta";



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
    /*
      Renders nothing HERE on purpose.

      The download-result placement moved inside `PreviewCard`, between the
      "Choose quality" header and the format grid — the point where the visitor
      is certainly looking, and still above the action rather than in front of
      it. `ResultAd` is mounted there.

      This branch stays rather than being folded into the `none` case because
      the decision engine's choice is still meaningful: it chose an ad over an
      affiliate offer or an upgrade prompt, and returning null here is what
      honours that without rendering a second copy of the same unit.
    */
    return null;
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

  // premium_prompt. The decision engine only returns this for a NON-premium
  // visitor, so `upgradeCta` resolves to the Pro offer — routed through the
  // shared helper anyway so there is exactly one place this wording lives.
  const offer = upgradeCta("free");
  if (!offer) return null;
  return (
    <UpsellCard
      icon={<Zap className="h-6 w-6" />}
      title={upgradeHeadline("free")}
      /*
        🔴 `offer.blurb`, not a string of its own (2026-10-04). The comment two
        lines up already claimed this was "routed through the shared helper
        anyway so there is exactly one place this wording lives" — and then the
        body overrode it with a hardcoded sentence. THIS is the card the owner
        was looking at when they said the Go Pro buttons never changed: the
        earlier fix landed on `tired-of-ads.tsx` and on the helper, and this
        line ignored both.
      */
      body={offer.blurb}
      href={offer.href}
      cta={offer.label}
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
  /*
    ── 🔴 IT WAS ONE RIGID ROW, AND A PHONE IS NOT WIDE (owner, 2026-10-04) ──

    "Arrange this pro card properly and make it look professional and
    prestige."

    `flex items-center` with three children and no wrapping gave the text
    column whatever was left after a 48px icon, a 16px gap and a button that
    refused to shrink. On a phone that is ~150px: the title broke after
    "Unlock everything" and the body ran to six ragged lines beside a button
    floating in its own vertical centre. Nothing was broken — it was just
    never given a narrow layout.

    So the row is the DESKTOP case and the stack is the default: full-width
    text that reads as a paragraph, and the action as a full-width bar under
    it, which is also the only way it clears the 44px tap target this project
    requires. `sm:` is where there is genuinely room for three columns.
  */
  return (
    <div className="mx-auto mt-6 w-full max-w-2xl overflow-hidden rounded-[1.25rem] border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-primary/[0.03] to-transparent p-5 shadow-elevated">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/15">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {/* `text-balance` so a two-line title splits evenly instead of
              leaving one orphaned word on the second line. */}
          <p className="text-pretty text-[15px] font-bold leading-snug tracking-[-0.01em]">{title}</p>
          <p className="mt-1 text-pretty text-[13px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-[2.75rem] w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:w-auto"
        >
          {cta} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
