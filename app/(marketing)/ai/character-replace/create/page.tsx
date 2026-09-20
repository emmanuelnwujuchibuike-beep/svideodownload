import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { CharacterReplaceWorkspace } from "@/features/ai/character-replace/character-replace-workspace";
import { isReplacementMode } from "@/lib/ai/character-replace/modes";

/**
 * /ai/character-replace/create?mode=… — the workspace, opened on the photo
 * step with the scope chosen on the page before (2026-09-20). Same posture as
 * the scope page: `noindex`, middleware-gated, every endpoint refusing an
 * anonymous subject. Dynamic only for the query — nothing per member is
 * rendered on the server. `basePath` is this page's own path — where Paystack
 * sends a member back after a recharge started here, allow-listed in the
 * top-up route.
 */
export const metadata: Metadata = {
  title: "Character Replace",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function PublicCharacterReplaceCreatePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}
      >
        <CharacterReplaceWorkspace basePath="/ai/character-replace/create" modeHref="/ai/character-replace" aiHref="/ai" historyHref="/ai/history" initialMode={isReplacementMode(mode) ? mode : null} />
      </main>
      {/* The download card, sound and haptic — the marketing group has no AppOverlays. */}
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
