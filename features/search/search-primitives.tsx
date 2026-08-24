import Link from "next/link";
import type { ReactNode } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { cn } from "@/lib/utils";

/**
 * The shared visual vocabulary of /search — section cards, headers, name lines.
 *
 * 🔴 NO `"use client"` HERE, DELIBERATELY. Everything in this file is pure and
 * hook-free, so the server-rendered discovery sections can use it as RSC and
 * ship zero JavaScript for the entire first screen, while the interactive
 * results view (which is a client component) can import exactly the same
 * pieces. One vocabulary, two rendering modes — the alternative was two sets
 * of near-identical card components that drift apart.
 *
 * Images live in `media.tsx` instead, and that file IS client — an `onError`
 * fallback is the only way to survive an expired source-CDN thumbnail, and
 * `onError` needs a client component. Keeping them apart is what stops one
 * unavoidable client leaf from converting this whole vocabulary.
 */

/** A name + optional verification seal, truncating as one unit. */
export function NameLine({
  name,
  verified,
  className,
  tickClassName = "h-[15px] w-[15px]",
}: {
  name: string;
  verified: boolean;
  className?: string;
  tickClassName?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <span className="truncate">{name}</span>
      {verified ? <VerifiedTick size="sm" className={cn("shrink-0", tickClassName)} /> : null}
    </span>
  );
}

/**
 * A section surface — the rounded card every block on this page sits on.
 * `bg-card` over the page's `bg-background`, a hairline border, and nothing
 * else: no shadow stack, no gradient overlay, no blur.
 */
export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-[22px] border border-border/70 bg-card", className)}>
      {children}
    </section>
  );
}

/** "🔥 Trending Now …………… See all" — the header inside a SectionCard. */
export function SectionHeader({
  icon,
  title,
  href,
  linkLabel = "See all",
}: {
  icon: ReactNode;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-primary" aria-hidden>
        {icon}
      </span>
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {href ? (
        <Link
          href={href}
          className="srch-press shrink-0 rounded-lg px-1 py-0.5 text-[13px] font-semibold text-primary hover:opacity-80"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
