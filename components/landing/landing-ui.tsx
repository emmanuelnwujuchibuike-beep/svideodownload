import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export { ICON_TILE, LANDING_CARD, PRIMARY_ACTION } from "@/components/landing/landing-classes";

/**
 * The landing's lower sections in the Frenz design system (owner, 2026-10-19: "restyle the landing
 * lower sections"). No design file draws them, so they follow the rules every redesigned page follows:
 * the same column as the hero above them (DownloadPageCore, max-w-2xl), white page, white cards with the
 * #ECE9F7 hairline, Sora headings, Hanken body, the gradient only on a primary action. No gradient text
 * — the highlighted word is flat violet, as the hero's "Discover." is.
 *
 * Server-only markup: nothing here ships JavaScript.
 */

/** One section: the hero's column, inside `.frenz-ui` so its fonts and ink apply. */
export function LandingSection({ id, labelledBy, className, children }: { id?: string; labelledBy: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("frenz-ui mx-auto max-w-2xl scroll-mt-24 px-4 py-6", className)}>
      {children}
    </section>
  );
}
