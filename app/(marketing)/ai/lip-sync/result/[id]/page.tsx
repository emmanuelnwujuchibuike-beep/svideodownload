import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { LipSyncWorkspace } from "@/features/ai/lip-sync/lip-sync-workspace";

/** /ai/lip-sync/result/[id] — one Lip Sync Pro job on the marketing-group door; ownership is checked by every API the page calls. */
export const metadata: Metadata = { title: "Video Ready", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PublicLipSyncResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();
  return (
    <>
      <SiteHeader landing />
      <main className="container max-w-3xl px-3 pb-10 sm:pb-14" style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}>
        <LipSyncWorkspace basePath="/ai/lip-sync" aiHref="/ai" historyHref="/ai/history" usageHref="/ai/usage" initialJobId={id} />
      </main>
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
