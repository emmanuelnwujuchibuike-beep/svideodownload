"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Profile dashboard is being wired feature-by-feature (owner: "any features that
 * has not been completely integrated should show coming soon cause we will install
 * everything one after the other, parts by parts"). Anything not yet backed by a
 * real route calls this instead of navigating — a clean, premium acknowledgement
 * rather than a dead click or a 404. Real, already-built destinations use a plain
 * <Link> (see the chrome), so navigation that works, works.
 */
export function comingSoon(feature: string) {
  toast(`${feature} is coming soon — rolling out part by part.`, "info");
}

/** A button that announces a not-yet-built feature. */
export function SoonButton({
  feature,
  className,
  children,
  ariaLabel,
  title,
}: {
  feature: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => comingSoon(feature)}
      aria-label={ariaLabel}
      title={title ?? `${feature} — coming soon`}
      className={className}
    >
      {children}
    </button>
  );
}

/**
 * A nav/tool entry that is either a real link (route exists) or a coming-soon
 * trigger. One component so the chrome can list everything the design shows while
 * only the built destinations actually navigate.
 */
export function MaybeLink({
  href,
  feature,
  className,
  children,
  ariaLabel,
}: {
  href?: string | null;
  feature: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <SoonButton feature={feature} ariaLabel={ariaLabel} className={className}>
      {children}
    </SoonButton>
  );
}

/** Small "View all" affordance used across section headers. */
export function ViewAll({ feature, href }: { feature: string; href?: string }) {
  return (
    <MaybeLink
      href={href}
      feature={`${feature} — View all`}
      className="text-sm font-semibold text-primary transition-colors hover:text-primary/80"
    >
      View all
    </MaybeLink>
  );
}

/** Tile helper: an icon square with the shared press feedback. */
export function IconSquare({
  icon: Icon,
  className,
  iconClassName,
}: {
  icon: ComponentType<{ className?: string }>;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("flex items-center justify-center rounded-2xl", className)}>
      <Icon className={cn("h-5 w-5", iconClassName)} />
    </span>
  );
}
