import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdvertiseFormats } from "@/features/ads-platform/advertise-formats";
import { AdvertisePlacementsPricing } from "@/features/ads-platform/advertise-placements-pricing";
import { GuidePage, guideMetadata } from "@/features/seo/guide-page";
import { guideSlug, guidesIn } from "@/lib/seo/guides";

/**
 * /advertise/<guide> — pricing, banner ads, video ads, the campaign guide (SEO, 2026-10-09).
 *
 * Static. The static siblings (rules, create, campaigns, payment) win over this
 * segment, and `dynamicParams = false` makes every other slug a real 404. Prices
 * and open formats are NEVER written here: they come from the admin's live
 * configuration through the same client islands /advertise uses.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

const find = (slug: string) => guidesIn("advertise").find((g) => guideSlug(g) === slug);

export function generateStaticParams() {
  return guidesIn("advertise").map((g) => ({ guide: guideSlug(g)! }));
}

export async function generateMetadata({ params }: { params: Promise<{ guide: string }> }): Promise<Metadata> {
  const g = find((await params).guide);
  return g ? guideMetadata(g) : {};
}

export default async function AdvertiseGuidePage({ params }: { params: Promise<{ guide: string }> }) {
  const g = find((await params).guide);
  if (!g) notFound();
  const live =
    g.live === "pricing" ? <AdvertisePlacementsPricing /> : g.live === "formats" ? (
      <section>
        <h2 className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">Formats open now</h2>
        <p className="mt-1.5 text-[14px] text-muted-foreground">Sizes, limits and prices shown here are always the current ones.</p>
        <div className="mt-4">
          <AdvertiseFormats />
        </div>
      </section>
    ) : null;
  return <GuidePage guide={g} live={live} />;
}
