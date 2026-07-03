import type { Metadata } from "next";

import { ReelsFeed } from "@/features/reels/reels-feed";
import { getHomeFeed } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reels",
  robots: { index: false, follow: false },
};

/** /reels — the full-screen, infinite, TikTok-style reels experience. */
export default async function ReelsPage() {
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon — reels are public discovery */
  }

  // Pull a wide first page and keep the videos so the deck opens full.
  const page = await getHomeFeed({ viewerId, sort: "recent", offset: 0, limit: 24 });
  const reels = page.items.filter((i) => i.mediaKind === "video");

  return <ReelsFeed initialItems={reels} initialOffset={page.nextOffset} />;
}
