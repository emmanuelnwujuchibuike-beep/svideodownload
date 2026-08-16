import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { FEED_GRID_SLOTS, setLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Each image is either a root-relative asset (/brand/…) or an absolute https URL —
  the shape `ImageUpload` returns from Supabase Storage's public URL. No data: URIs
  and no http:, matching `isAllowedImageUrl` in lib/landing/settings.ts; the store
  re-validates too, so a bad value can never reach the public page.
*/
const isAssetOrHttps = (v: string) => v.startsWith("/") || v.startsWith("https://");

/** A non-empty grid image: a site asset path or an absolute https URL. */
const gridImage = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isAssetOrHttps, { message: "Image must be an https URL or a site asset path." });

/** The reels poster: same shape, but "" (cleared) is allowed. */
const reelsPoster = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || isAssetOrHttps(v), {
    message: "Image must be an https URL or a site asset path.",
  });

const schema = z.object({
  reelsPosterUrl: reelsPoster.default(""),
  feedGridImages: z.array(gridImage).max(FEED_GRID_SLOTS).default([]),
  // Same shape and same clearable rule as the reels poster.
  wallpaperCtaImageUrl: reelsPoster.default(""),
});

/** Admin-only: set the landing page's reels poster and 2×2 feed-grid images. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
  }

  try {
    await setLandingSettings(parsed.data);
  } catch {
    return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  }

  /*
    ── On-demand revalidation, not just a 60s poll (owner, 2026-08-16: "There's
    a bug that makes when I load frenzsave.com on cold start it shows an older
    version until I refresh") ─────────────────────────────────────────────────

    `/` is `force-static` (app/(marketing)/page.tsx) under `revalidate = 60`
    (app/layout.tsx) — Vercel's ISR serves whatever HTML it last generated and
    only regenerates in the BACKGROUND once a request arrives after that
    60-second window has elapsed, handing the STALE copy to the very request
    that triggered the regeneration. Landing content changes only when an admin
    edits it, not every 60 seconds, so blind time-based polling was buying
    nothing but a guaranteed one-stale-load window on every edit — exactly the
    "shows old, refresh shows current" report, and the more likely trigger the
    fresher this settings panel gets used.

    `revalidatePath("/")` clears the cached HTML the instant a save succeeds,
    so the very next visitor (including the admin, re-checking their own
    change) gets the regenerated page on their FIRST request. The 60s
    time-based revalidate stays as a safety net for any other write path to
    landing-visible data that doesn't (yet) call this — belt and braces, not
    a replacement for it.
  */
  revalidatePath("/");

  /*
    ── Warm the optimizer BEFORE anyone else hits it (owner, 2026-08-16: "when
    I changed image on the landing page wallpaper button, it broke the
    performance") ──────────────────────────────────────────────────────────

    Nothing was actually broken — this is the cold-cache path being caught in
    the act. `ImageUpload` writes every upload to a brand-new storage path
    (`${user.id}/${kind}-${Date.now()}.jpg`), so ANY change to this field is,
    by construction, a URL `next/image` has never optimized before. Vercel's
    image optimizer caches by (url, width, quality) and does the resize/AVIF
    encode SYNCHRONOUSLY on whichever request is first to ask for a given
    combination — and this tile is `priority` (the landing page's measured
    LCP element, see wallpaper-cta.tsx), so that first-request cost lands
    exactly on LCP. An admin who saves a new image and immediately reruns
    Lighthouse is, structurally, guaranteed to be that first request.

    So: fire the same requests a real visitor's `srcset` would make, right
    now, in the background, for every rung `next.config.ts`'s `deviceSizes`
    offers — by the time anyone else (including the admin, testing again a
    minute later) loads the page, every variant is already a cache hit. Quality
    75 matches `next/image`'s own default (wallpaper-cta.tsx sets none).

    `after()`, not awaited: this must not add latency to the admin's save, and
    a serverless function can freeze the instant its response is sent, so a
    bare fire-and-forget call is not reliable here — same reasoning as every
    other `after()` use in this codebase (see the
    [[sw-swx-duplicate-const-bug]] project note).
  */
  const DEVICE_SIZES = [640, 828, 1080, 1920, 2560];
  if (parsed.data.wallpaperCtaImageUrl) {
    const url = parsed.data.wallpaperCtaImageUrl;
    after(async () => {
      await Promise.all(
        DEVICE_SIZES.map((w) =>
          fetch(`${SITE_URL}/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75`, { cache: "no-store" }).catch(() => {}),
        ),
      );
    });
  }

  return NextResponse.json({ ok: true });
}
