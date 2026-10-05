import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { TextToAudioWorkspace } from "@/features/ai/text-to-audio/text-to-audio-workspace";
import { getShowcaseSlides } from "@/lib/ai/showcase/server";

/**
 * /ai/text-to-audio — Text to Audio on the marketing-group door (2026-09-21),
 * the twin of /studio/ai/text-to-audio: `noindex`, middleware-gated (`/ai` is
 * guarded there), every endpoint refusing an anonymous subject. Dynamic: the
 * workspace reads the member's own configuration, allowance and jobs.
 */
export const metadata: Metadata = { title: "Text to Audio", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicTextToAudioPage({ searchParams }: { searchParams: Promise<{ job?: string; voice?: string }> }) {
  const { job, voice } = await searchParams;
  // The showcase opens every AI page (owner's reference); cached until an admin saves.
  const slides = await getShowcaseSlides();
  const initialJobId = typeof job === "string" && /^[0-9a-fA-F-]{36}$/.test(job) ? job : null;
  const initialVoiceId = typeof voice === "string" && /^clone:[0-9a-fA-F-]{36}$/.test(voice) ? voice : null;
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <TextToAudioWorkspace slides={slides} basePath="/ai/text-to-audio" aiHref="/ai" libraryHref="/ai/audio" lipSyncHref="/ai/lip-sync" historyHref="/ai/history" usageHref="/ai/usage" initialJobId={initialJobId} initialVoiceId={initialVoiceId} />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
