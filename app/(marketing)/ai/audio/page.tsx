import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AudioLibrary } from "@/features/ai/text-to-audio/audio-library";
import { getShowcaseSlides } from "@/lib/ai/showcase/server";

/** /ai/audio — the Audio Library on the marketing-group door, the twin of /studio/ai/audio. */
export const metadata: Metadata = { title: "Audio Library", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicAudioLibraryPage() {
  // large screens show the showcase on every AI page (owner, 2026-10-05); cached until an admin saves
  const slides = await getShowcaseSlides();
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <AudioLibrary slides={slides} ttaHref="/ai/text-to-audio" lipSyncHref="/ai/lip-sync" aiHref="/ai" />
      </main>
      <SiteFooterMinimal />
    </>
  );
}
