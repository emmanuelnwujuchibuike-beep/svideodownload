import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { LipSyncWorkspace } from "@/features/ai/lip-sync/lip-sync-workspace";

/**
 * /ai/lip-sync — Lip Sync Pro on the marketing-group door (2026-09-21), the
 * twin of /studio/ai/lip-sync: `noindex`, middleware-gated (`/ai` is guarded
 * there), every endpoint refusing an anonymous subject. Dynamic: the
 * workspace reads the member's own configuration and jobs. The Explore page
 * on this route links here; the Studio twin links to its own.
 */
export const metadata: Metadata = { title: "Lip Sync Pro", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default function PublicLipSyncPage() {
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <LipSyncWorkspace basePath="/ai/lip-sync" aiHref="/ai" historyHref="/ai/history" usageHref="/ai/usage" />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
