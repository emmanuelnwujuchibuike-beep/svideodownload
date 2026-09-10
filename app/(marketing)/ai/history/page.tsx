import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { FrenzAIHistoryPage } from "@/features/ai/frenz-ai-history-page";
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
  /*
    🔴 nofollow AND no canonical (owner, 2026-09-09, permanent AI rule).

    `index: false` was already right. `follow: true` was not: it invites a
    crawler that reached this page to walk onward into the rest of the AI
    surface, which is the thing being taken out of the index. And a canonical
    is an instruction about HOW to index a page that must not be indexed — it
    also pointed at /ai, which is itself noindex now, so it consolidated
    nothing.
  */
  robots: { index: false, follow: false, nocache: true },
};

/*
  ── 🔴 STATIC AGAIN, AND THAT IS THE "OPEN INSTANT" FIX ────────────────────

  Owner, 2026-09-09: "all the ai pages should cache and open instant like how
  other pages does."

  This was `force-dynamic` with the comment "a live tool: it reads a session and
  a guest cookie on every request". That WAS true, and it is not any more: the
  session read moved to middleware and the guest cookie no longer exists (Frenz
  AI is signed-in only). What is left on the server is a header, a footer and
  two client components — nothing request-scoped at all.

  So the document is prerendered and served from the edge, and everything that
  actually varies per member is fetched by the client components inside it,
  which already paint from their own localStorage cache on the first frame
  (lib/ai/history-cache.ts). That combination is what makes the download
  history feel instant, and it is now the same combination here.

  ⚠️ Access is unaffected: middleware redirects an unauthenticated request
  before this document is ever served, and every AI endpoint refuses an
  anonymous subject independently.
*/
export const dynamic = "force-static";

export default async function PublicFrenzAIHistoryPage() {

  // Off means the anonymous door is closed; the Studio route sends them to
  // login with a `next` so the journey still completes.
  /*
    ── 🔴 SIGNED IN, OR NOTHING (owner, 2026-09-09, standing product rule) ───

    "AI must NOT be publicly exposed as a major landing-page feature, indexed
    standalone page, or publicly usable tool… If an unauthenticated user
    somehow attempts to access an AI route directly, securely redirect them to
    the normal authentication flow."

    This route used to render for anonymous visitors whenever
    `frenzAiPublicEnabled` was on — deliberately, so the AdSense crawler could
    see the feature. That rule is replaced, and the setting no longer decides
    anything here: an unauthenticated request is redirected unconditionally.

    🔴 The redirect goes to the SIGNED-IN route rather than straight to
    /login, because that route already resolves the sign-in journey properly —
    it sends an anonymous visitor to login with a `next` that brings them back
    to the AI page afterwards. One implementation of that flow, not two.

    ⚠️ This is the page half. The API half is enforced independently in
    `resolveAiSubject`, which returns a null subject for anyone without a
    session — because a page redirect protects nothing from a direct fetch.
  */
  /*
    ── 🔴 THE AUTH GATE MOVED TO MIDDLEWARE, AND THAT IS A PERFORMANCE FIX ───

    Owner, 2026-09-09: "the ai pages still doesnt cache and open instant like
    the download history, it should cache and not load on every entry."

    This page used to call `createClient()` and `getUser()` here to enforce
    the signed-in-only rule. The rule is right; doing it HERE forced the route
    dynamic, so every entry paid a Supabase round-trip before any HTML — on a
    page that had been ISR and instant.

    `middleware.ts` now guards `/ai` and `/studio`, where a visitor with no
    auth cookie is redirected with NO `getUser()` call at all. Same guarantee,
    none of the per-entry cost, and this route is cacheable again.

    ⚠️ The API gate is separate and still there: `resolveAiSubject` refuses an
    anonymous subject on every AI endpoint, because a direct fetch never passes
    through a page.
  */

  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, 4rem) + 1rem)" }}
      >
        <FrenzAIHistoryPage />
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
