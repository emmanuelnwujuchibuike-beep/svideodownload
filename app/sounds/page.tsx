import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { SoundsLibrary } from "@/features/social/sounds-library/sounds-library";

// No async work in this component — the page (top bar, title, search, tabs, chips) paints the instant the route is
// navigated to; the sounds themselves are fetched client-side after it opens (/api/sounds/library).
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sounds — FrenzSave",
  description: "Original audio from creators you follow. Preview, save, and build your next Reel around it.",
  robots: { index: false, follow: false },
};

/** The Sounds library — design/frenz-sounds.html (owner, 2026-10-30). */
export default function SoundsPage() {
  return (
    <>
      <SiteHeader social />
      <main className="pt-[var(--frenz-safe-top)] lg:pt-16">
        <SoundsLibrary />
      </main>
    </>
  );
}
