import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { CharacterReplaceWorkspace } from "@/features/ai/character-replace/character-replace-workspace";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /ai/character-replace — the tool's workspace, signed-in door
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §2): inside the existing authenticated Frenz AI
 * page — no public landing page, no indexed SEO page, nothing on the home
 * hero. So this route is exactly what every other AI page is:
 *
 *   · `noindex, nofollow`, no canonical, no Open Graph — a tool is nothing
 *     for a crawler, and the standing rule (2026-09-09) keeps AI out of the
 *     index entirely;
 *   · `force-static` — the document is a header, a footer and one client
 *     component that fetches everything that varies per member, so it is
 *     prerendered and served from the edge like the download history;
 *   · the signed-in gate is middleware's (`/ai` is guarded there without a
 *     `getUser()` round-trip), and every AI endpoint refuses an anonymous
 *     subject on its own.
 *
 * `basePath` is this page's own path — where Paystack sends a member back
 * after a recharge started here, allow-listed in the top-up route.
 */
export const metadata: Metadata = {
  title: "Character Replace",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-static";

export default function PublicCharacterReplacePage() {
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem)) + 1rem)" }}
      >
        <CharacterReplaceWorkspace basePath="/ai/character-replace" aiHref="/ai" historyHref="/ai/history" />
      </main>
      {/* The download card, sound and haptic — the marketing group has no AppOverlays. */}
      <AIDownloadOverlay />
      <SiteFooterMinimal />
    </>
  );
}
