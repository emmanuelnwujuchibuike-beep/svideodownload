import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SoundDiscoveryClient } from "@/features/social/sound-discovery-client";

// No async work in this component — the shell (header, title, filter chips)
// must paint the instant the route is navigated to. The actual sounds list
// is fetched client-side, after the page has already opened (see
// sound-discovery-client.tsx), behind the global skeleton.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sounds — FrenzSave",
  description: "Discover trending and new sounds, and use them in your own Reel.",
};

export default function SoundsPage() {
  return (
    <>
      <SiteHeader social />
      <main className="container max-w-4xl pb-24 pt-[calc(var(--frenz-safe-top)+1.25rem)] lg:pt-24">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Sounds</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Trending and new sounds — tap one to use it in your own Reel.</p>

        <div className="mt-5">
          <SoundDiscoveryClient />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
