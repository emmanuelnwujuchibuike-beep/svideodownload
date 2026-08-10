import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { WallpaperSeoContent } from "@/components/wallpapers/wallpaper-seo-content";
import { WallpaperExplore } from "@/features/wallpapers/wallpaper-explore";
import { jsonLd } from "@/lib/seo/json-ld";
import {
  WALLPAPERS_DESCRIPTION,
  WALLPAPERS_KEYWORDS,
  WALLPAPERS_TITLE,
  wallpapersJsonLd,
} from "@/lib/seo/wallpapers";
import { SITE_URL as siteUrl } from "@/lib/site";
import { listWallpapers } from "@/lib/wallpapers-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Search metadata (owner, 2026-08-09: "make the wallpaper page a seo page and
 * add it to sitemap for indexing").
 *
 * The title and description live in `lib/seo/wallpapers.ts` with a test on their
 * rendered length, because both are silently destroyed by being slightly too
 * long — Google truncates rather than warns, and nothing in a build catches it.
 *
 * `?reels=1` opens the full-screen viewer, and the canonical deliberately drops
 * it: that URL is the same page in a different state, not a second document, and
 * letting it be indexed separately would split the page's own signals between
 * two URLs and show a searcher a full-screen overlay as their first impression.
 */
export const metadata: Metadata = {
  title: WALLPAPERS_TITLE,
  description: WALLPAPERS_DESCRIPTION,
  keywords: WALLPAPERS_KEYWORDS,
  alternates: { canonical: "/wallpapers" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: `${siteUrl}/wallpapers`,
    siteName: "FrenzSave",
    title: WALLPAPERS_TITLE,
    description: WALLPAPERS_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: WALLPAPERS_TITLE,
    description: WALLPAPERS_DESCRIPTION,
  },
};

/**
 * /wallpapers — the public Wallpapers surface, reached from the landing hero's
 * Wallpapers button.
 *
 * The page IS the download page's Wallpapers section, given its own room: a
 * premium header and the full library as a grid, with the reels viewer one tap
 * away (owner, 2026-08-03).
 *
 * `?reels=1` skips the grid and opens the viewer immediately — that is what the
 * "Browse full screen" entry points mean, and it keeps the original
 * straight-to-reels behaviour on one route instead of a second near-identical
 * wallpaper page.
 *
 * Open to signed-out visitors on purpose (owner): they can scroll the whole
 * library and download from it. Engagement is a signed-in affordance, so
 * `canEngage` follows the session.
 *
 * ── Why it stays dynamic even as a search page ────────────────────────────────
 * Everything else built for search here is `force-static`. This is not, and the
 * reason is that the page renders per-viewer state: whether YOU have liked or
 * saved each wallpaper. Prerendering would either bake one visitor's engagement
 * into everyone's HTML or drop the feature.
 *
 * That costs a crawler nothing it cares about. `getUser()` short-circuits with no
 * session, so a bot pays one Supabase select and no auth round-trip, and the
 * bytes themselves are already CDN-cached and immutable. Rendering strategy is
 * not a ranking factor; served HTML is, and a crawler gets the complete document
 * either way.
 */
export default async function WallpapersPage({
  searchParams,
}: {
  searchParams: Promise<{ reels?: string }>;
}) {
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* signed out — the library is still public */
  }

  const [items, { reels }] = await Promise.all([listWallpapers(viewerId), searchParams]);

  return (
    <>
      {/*
        Structured data, built from the LIVE list rather than written by hand, so
        it describes the library that is actually on the page. Serialised through
        `jsonLd()` — wallpaper titles are operator-authored, and a raw stringify
        in a <script> is a stored-XSS vector the moment one contains a closing
        script tag.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(wallpapersJsonLd(items, siteUrl)) }}
      />
      <WallpaperExplore items={items} canEngage={!!viewerId} openReels={reels === "1"}>
        <WallpaperSeoContent items={items} />
      </WallpaperExplore>
      {/*
        The footer, which this page had no equivalent of.

        /wallpapers sits outside both the (app) and (marketing) layouts, so it
        rendered with no footer AND no bottom navigation — its only outbound
        internal link was the back arrow. A page with one link out is a dead end
        for a visitor and a leaf for a crawler: nothing it earns flows anywhere
        else on the site. This is the same footer every marketing page carries.
      */}
      <SiteFooter />
    </>
  );
}
