import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FrenzAIUsagePage } from "@/features/ai/frenz-ai-usage-page";

/**
 * /ai/usage — balance, free counters and the full statement.
 *
 * Owner, 2026-09-13: "The usage and history button in the AI page should open
 * the usage page, not the history page because there is already a history
 * card button below." There was no usage page; this is it. The dashboard's
 * row now points here, and the tool grid's card keeps history.
 *
 * Same shape as /ai/history, for the same reasons written there: `noindex`,
 * nofollow, no canonical (a member's private statement is nothing for a
 * crawler), and `force-static` — the document carries a header, a footer and
 * one client component that fetches everything that varies per member. The
 * signed-in gate is middleware's (`/ai` is guarded there without a
 * `getUser()` round-trip), and the API refuses an anonymous subject on its
 * own.
 */
export const metadata: Metadata = {
  title: "Your Frenz AI usage",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-static";

export default function PublicFrenzAIUsagePage() {
  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, 4rem) + 1rem)" }}
      >
        <FrenzAIUsagePage aiHref="/ai" />
      </main>
      <SiteFooter />
    </>
  );
}
