import { ArrowRight, Megaphone } from "lucide-react";

import type { PublicAdSummary } from "@/lib/ads-platform/public-summary";
import { ICON_TILE, LANDING_CARD, LandingSection, PRIMARY_ACTION } from "@/components/landing/landing-ui";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ECOSYSTEM, BY HIERARCHY — Landing + Download brief (owner, 2026-10-08)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "DOWNLOAD · CREATE · DISCOVER · PROMOTE — through hierarchy rather than
 * clutter." The hero above stays the download (the shared DownloadPageCore);
 * these are the four steps down from it, each smaller than the last:
 *
 *   Frenz AI   PRIMARY: the one large panel below the hero, with AI Reels inside it
 *   Promote    BUSINESS: one quiet card — present, never dominant
 *
 * 2026-10-19 (owner: "below section shouldn't load on landing", "remove duplicate"): Frenz AI and
 * the downloader's story below it moved to lib/landing/deferred-sections.ts, fetched only when
 * scrolled near; Discover (Reels · Feed · Wallpapers) was removed as a duplicate of the hero's Tools,
 * the bottom nav and the footer. Promote stays here, in the document, because its facts are live.
 *
 * Server components with no client code: links, not engines (§27). Nothing
 * here loads a reel, an ad creative or a video; the advertising facts
 * come from `getPublicAdSummary()` at the page's regeneration — never per
 * visitor.
 */

/* ─────────────────────────────── Promote ─────────────────────────────── */

/**
 * §9 BUSINESS. Visible to everyone, signed in or not — a quiet white card, not a
 * sales banner. Hidden entirely when an admin has advertising switched off
 * (§36); the placements are the admin's enabled ones by their human names
 * (§14), and a promotion appears only while it is live (§16).
 */
export function PromoteSection({ ads }: { ads: PublicAdSummary }) {
  if (!ads.enabled) return null;
  const promo = ads.promotion;
  return (
    <LandingSection id="advertise" labelledBy="landing-promote">
      <div className={cn(LANDING_CARD, "p-4")}>
        <div className="flex items-start gap-3">
          <span className={ICON_TILE} aria-hidden>
            <Megaphone className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-frenz-violet">Promote on Frenzsave</p>
            <h2 id="landing-promote" className="m-0 mt-1 font-heading text-[20px] font-bold leading-tight tracking-[-0.4px] text-frenz-ink">
              Reach people across Frenzsave.
            </h2>
            <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-frenz-muted">
              Put your brand, product or content in front of people as they save, watch and create.
            </p>
          </div>
        </div>
        {ads.placements.length ? (
          // A taste, not the catalogue: the first five, then "and more" — the full list lives on /advertise (§14, §23)
          <ul className="m-0 mt-3.5 flex list-none flex-wrap gap-1.5 p-0" aria-label="Where ads appear">
            {ads.placements.slice(0, 5).map((p) => (
              <li key={p} className="rounded-full bg-frenz-fill px-3 py-1 text-[12.5px] font-semibold text-frenz-ink/80">
                {p}
              </li>
            ))}
            {ads.placements.length > 5 ? <li className="px-1 py-1 text-[12.5px] font-semibold text-frenz-muted">and more</li> : null}
          </ul>
        ) : null}
        {promo ? (
          <p className="m-0 mt-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
            {promo.name}
            {promo.extraDays > 0 ? ` · +${promo.extraDays} bonus ${promo.extraDays === 1 ? "day" : "days"}` : ""}
            {promo.discountPercent > 0 ? ` · ${promo.discountPercent}% off` : ""}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <TapOnceLink href="/advertise" prefetch={false} spinner={false} data-track="advertise_clicked" className={PRIMARY_ACTION}>
            Advertise on Frenzsave <ArrowRight className="h-4 w-4" aria-hidden />
          </TapOnceLink>
          <TapOnceLink href="/advertise/rules" className="inline-flex min-h-[44px] items-center text-[14px] font-bold text-frenz-blue no-underline">
            Advertising rules
          </TapOnceLink>
        </div>
      </div>
    </LandingSection>
  );
}
