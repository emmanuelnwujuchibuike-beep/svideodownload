import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { FrenzAIHistoryPage } from "@/features/ai/frenz-ai-history-page";
import { getLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /ai/history — every video this visitor has made, account or not
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "I still don't see the AI history button and page in the
 * AI landing page so users can see all their video edits they made even non
 * signed in users."
 *
 * ── 🔴 GUESTS SEE THEIR OWN WORK, AND NOTHING NEW WAS NEEDED FOR IT ────────
 *
 * The whole mechanism has existed since Part 2 and was extended for guests in
 * Part 5:
 *
 *   · `resolveAiSubject` resolves every request to a subject — a member via
 *     their session, a guest via a signed, HttpOnly identifier;
 *   · `subjectScope` filters every read by that subject, using the member's own
 *     client (so RLS decides) or the service role with an explicit `guest_id`;
 *   · the identifier is HMAC-signed and the browser has never seen the key, so
 *     a visitor cannot ask for somebody else's rows — they cannot name them.
 *
 * `GET /api/ai/jobs` has therefore always answered a guest with a guest's
 * history. What was missing was a page that asked.
 *
 * ── 🔴 `noindex`, like /ai/clean ───────────────────────────────────────────
 *
 * Its content is one visitor's private job list — nothing for a crawler to
 * read, and exactly the thin page that gets a site flagged. `/ai` is the
 * crawlable door; this one only needs to be reachable.
 */
export const metadata: Metadata = {
  title: "Your Frenz AI videos",
  robots: { index: false, follow: true },
  alternates: { canonical: `${SITE_URL}/ai` },
};

// A live list: it reads a session and a guest cookie on every request.
export const dynamic = "force-dynamic";

export default async function PublicFrenzAIHistoryPage() {
  const { frenzAiPublicEnabled } = await getLandingSettings();

  // Off means the anonymous door is closed; the Studio route sends them to
  // login with a `next` so the journey still completes.
  if (!frenzAiPublicEnabled) redirect("/studio/ai/history");

  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, 4rem) + 1rem)" }}
      >
        <FrenzAIHistoryPage cleanHref="/ai/clean" />
      </main>
      {/*
        The download card, sound and haptic. The MARKETING group has no
        AppOverlays, so a download started from a history row would otherwise
        finish with no card at all.
      */}
      <AIDownloadOverlay />
      <SiteFooter />
    </>
  );
}
