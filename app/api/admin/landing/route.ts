import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { FEED_GRID_SLOTS, setLandingSettings } from "@/lib/landing/settings";

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
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  }
}
