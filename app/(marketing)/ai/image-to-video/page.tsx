import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { ImageToVideoWorkspace } from "@/features/ai/video/image-to-video-workspace";
import { aiCurrencySymbol } from "@/lib/landing/bounds";
import { getLandingSettings } from "@/lib/landing/settings";

/**
 * /ai/image-to-video — the twin of /studio/ai/image-to-video on the marketing door:
 * `noindex`, middleware-gated, every endpoint refusing an anonymous subject.
 */
export const metadata: Metadata = { title: "Image to Video", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicImageToVideoWorkspacePage() {
  const settings = await getLandingSettings();
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <ImageToVideoWorkspace historyHref="/ai/history" currencySymbol={aiCurrencySymbol(settings.frenzAiCurrency)} />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
