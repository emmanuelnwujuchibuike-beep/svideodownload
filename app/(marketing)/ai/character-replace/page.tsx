import type { Metadata } from "next";

import { SiteFooterMinimal } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FrenzAIExplore } from "@/features/ai/frenz-ai-explore";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /ai/character-replace — Explore AI Studio, signed-in door
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §2): inside the existing authenticated Frenz AI
 * page — no public landing page, no indexed SEO page, nothing on the home
 * hero. So this route is exactly what every other AI page is:
 *
 *   · `noindex, nofollow`, no canonical, no Open Graph — a tool is nothing
 *     for a crawler, and the standing rule (2026-09-09) keeps AI out of the
 *     index entirely;
 *   · `force-static` — a header, a footer and one client component that
 *     fetches everything that varies per member, prerendered and served from
 *     the edge; the signed-in gate is middleware's (`/ai` is guarded there
 *     without a `getUser()` round-trip), and every AI endpoint refuses an
 *     anonymous subject on its own.
 *
 * 2026-09-20: this is Explore AI Studio — the grid of every AI feature, how
 * it works, credits & usage (owner: "remove the AI structure and use the grid
 * that has all AI features"); the workspace lives at /ai/character-replace/create.
 * Static is safe HERE: this group's header reads no cookie, the middleware
 * guards `/ai` — unlike the Studio-shell twin, whose layout calls getUser().
 */
export const metadata: Metadata = {
  title: "Explore AI Studio",
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
        <FrenzAIExplore createPath="/ai/character-replace/create" aiHref="/ai" historyHref="/ai/history" usageHref="/ai/usage" />
      </main>
      <SiteFooterMinimal />
    </>
  );
}
