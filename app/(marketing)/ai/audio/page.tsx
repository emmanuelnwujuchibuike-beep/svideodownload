import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AudioLibrary } from "@/features/ai/text-to-audio/audio-library";

/** /ai/audio — the Audio Library on the marketing-group door, the twin of /studio/ai/audio. */
export const metadata: Metadata = { title: "Audio Library", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default function PublicAudioLibraryPage() {
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <AudioLibrary ttaHref="/ai/text-to-audio" lipSyncHref="/ai/lip-sync" aiHref="/ai" />
      </main>
      <SiteFooterMinimal />
    </>
  );
}
