import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { VoiceCloningWorkspace } from "@/features/ai/voice-clone/voice-cloning-workspace";

/**
 * /ai/voice-cloning — Voice Cloning on the marketing-group door (2026-09-27),
 * the twin of /studio/ai/voice-cloning: `noindex`, middleware-gated (`/ai` is
 * guarded there), every endpoint refusing an anonymous subject. Dynamic: the
 * workspace reads the member's own configuration, allowance and voices.
 *
 * 🔴 Both doors exist because the Explore grid appears on both, and a card that
 * links to a page only one of them has is a 404 (the Lip Sync lesson, 728fc7f).
 */
export const metadata: Metadata = { title: "Voice Cloning", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicVoiceCloningPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const initialJobId = typeof job === "string" && /^[0-9a-fA-F-]{36}$/.test(job) ? job : null;
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <VoiceCloningWorkspace basePath="/ai/voice-cloning" aiHref="/ai" ttaHref="/ai/text-to-audio" lipSyncHref="/ai/lip-sync" historyHref="/ai/history" usageHref="/ai/usage" initialJobId={initialJobId} />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
