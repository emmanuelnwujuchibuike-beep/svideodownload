import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { LipSyncWorkspace } from "@/features/ai/lip-sync/lip-sync-workspace";
import { getShowcaseSlides } from "@/lib/ai/showcase/server";

/**
 * /ai/lip-sync — Lip Sync Pro on the marketing-group door (2026-09-21), the
 * twin of /studio/ai/lip-sync: `noindex`, middleware-gated (`/ai` is guarded
 * there), every endpoint refusing an anonymous subject. Dynamic: the
 * workspace reads the member's own configuration and jobs. The Explore page
 * on this route links here; the Studio twin links to its own.
 */
export const metadata: Metadata = { title: "Lip Sync Pro", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicLipSyncPage({ searchParams }: { searchParams: Promise<{ audio?: string; voice?: string }> }) {
  const { audio, voice } = await searchParams;
  // Large screens show the showcase on every AI page (owner, 2026-10-05); cached until an admin saves.
  const slides = await getShowcaseSlides();
  const initialAssetId = typeof audio === "string" && /^[0-9a-fA-F-]{36}$/.test(audio) ? audio : null;
  // 2026-09-27: ?voice=clone:<uuid> from the Voice Library — preselected only; the server resolves it
  const initialVoiceId = typeof voice === "string" && /^clone:[0-9a-fA-F-]{36}$/.test(voice) ? voice : null;
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <LipSyncWorkspace slides={slides} basePath="/ai/lip-sync" aiHref="/ai" historyHref="/ai/history" usageHref="/ai/usage" audioHref="/ai/audio" initialAssetId={initialAssetId} initialVoiceId={initialVoiceId} />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
