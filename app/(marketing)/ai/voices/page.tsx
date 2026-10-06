import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { VoiceLibrary } from "@/features/ai/voice-clone/voice-library";
import { getShowcaseSlides } from "@/lib/ai/showcase/server";

/** /ai/voices — the marketing-door twin of /studio/ai/voices (2026-09-27). `noindex`, middleware-gated, member-scoped. */
export const metadata: Metadata = { title: "Your Voices", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicVoicesPage() {
  // large screens show the showcase on every AI page (owner, 2026-10-05); cached until an admin saves
  const slides = await getShowcaseSlides();
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <VoiceLibrary slides={slides} cloneHref="/ai/voice-cloning" ttaHref="/ai/text-to-audio" lipSyncHref="/ai/lip-sync" />
      </main>
      <SiteFooterMinimal />
    </>
  );
}
