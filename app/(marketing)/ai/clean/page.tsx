import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AICleanWorkspace } from "@/features/ai/ai-clean-workspace";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /ai/clean — the tool itself, runnable without an account
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "so anonymous users can use."
 *
 * ── 🔴 THIS ACTUALLY RUNS. IT IS NOT A PREVIEW WITH A SIGN-IN WALL. ─────────
 *
 * Everything the server needs for that already exists and is already enforced:
 *
 *   · `resolveAiSubject` issues a signed, HttpOnly guest id and resolves every
 *     request to a subject — a member or a guest — so a job has an owner
 *     either way;
 *   · the policy table gives `guest` its own row (2 a day), reserved through
 *     the SAME atomic counter every plan uses, with an IP ceiling underneath
 *     it so clearing a cookie is not a fresh allowance;
 *   · storage paths, ownership checks and the signed result all key off the
 *     subject, so one guest can never read another's video.
 *
 * None of that is new here. What was missing was a door, and this is it.
 *
 * ── One workspace, two routes ───────────────────────────────────────────────
 *
 * `AICleanWorkspace` is rendered unchanged. It asks the server what this
 * visitor may do and renders the answer; it has never known or cared whether
 * that visitor is signed in. Forking it for guests would have been two
 * implementations of the same screen, drifting.
 *
 * ── 🔴 `noindex`, unlike /ai ────────────────────────────────────────────────
 *
 * The marketing page is the crawlable one. This is a TOOL: its content is a
 * file picker and whatever job the visitor happens to have running, which is
 * nothing for a crawler to read and exactly the thin page that gets a site
 * flagged. The AdSense reason for being public is served by /ai; this route
 * only needs to be reachable.
 */
export const metadata: Metadata = {
  title: "AI Clean",
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

export default async function PublicAICleanPage() {

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
        <AICleanWorkspace />
      </main>
      {/*
        The download card, sound and haptic. This route is in the MARKETING
        group, which has no AppOverlays — so an AI download finished here with
        no card at all, and the visitor met it later on whichever page happened
        to mount one. See the component for why it is here and not inside the
        shared workspace.
      */}
      <AIDownloadOverlay />
      <SiteFooter />
    </>
  );
}
