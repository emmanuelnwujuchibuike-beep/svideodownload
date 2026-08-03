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
 * /wallpapers — the public Explore surface, reached from the landing's
 * "Explore wallpapers" button.
 *
 * Open to signed-out visitors on purpose (owner): they can scroll the whole
 * library in reels form and download from it. Engagement is a signed-in,
 * download-page affordance, so `canEngage` follows the session.
 */
export default async function WallpapersPage() {
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

  const items = await listWallpapers(viewerId);

  return <WallpaperExplore items={items} canEngage={!!viewerId} />;
}
