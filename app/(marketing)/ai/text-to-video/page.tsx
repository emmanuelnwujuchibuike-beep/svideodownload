import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { TextToVideoWorkspace } from "@/features/ai/video/text-to-video-workspace";
import { getShowcaseSlides } from "@/lib/ai/showcase/server";
import { aiCurrencySymbol } from "@/lib/landing/bounds";
import { getLandingSettings } from "@/lib/landing/settings";

/**
 * /ai/text-to-video — the twin of /studio/ai/text-to-video on the marketing door:
 * `noindex`, middleware-gated, every endpoint refusing an anonymous subject.
 */
export const metadata: Metadata = { title: "Text to Video", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicTextToVideoWorkspacePage() {
  // The showcase opens every AI page (owner's reference); cached until an admin saves.
  const [settings, slides] = await Promise.all([getLandingSettings(), getShowcaseSlides()]);
  return (
    <>
      <SiteHeader landing />
      {/* px-0: the workspace shell carries the 16 px gutter itself — a second one here squeezed the settings (redesign page 3) */}
      <main className="container max-w-3xl px-0 pb-10 sm:px-3 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <TextToVideoWorkspace historyHref="/ai/history" currencySymbol={aiCurrencySymbol(settings.frenzAiCurrency)} slides={slides} base="/ai" />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
