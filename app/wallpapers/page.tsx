import type { Metadata } from "next";

import { WallpaperExplore } from "@/features/wallpapers/wallpaper-explore";
import { listWallpapers } from "@/lib/wallpapers-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wallpapers — free HD backgrounds",
  description: "Scroll a full-screen gallery of free HD wallpapers and save any of them to your device.",
  alternates: { canonical: "/wallpapers" },
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

  return <WallpaperExplore items={items} canEngage={!!viewerId} openReels={reels === "1"} />;
}
