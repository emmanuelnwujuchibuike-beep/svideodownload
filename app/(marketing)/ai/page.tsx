import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FrenzAIWelcome } from "@/features/ai/frenz-ai-welcome";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /ai — Frenz AI, for everybody
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "the visible to sign out user in admin dashboard is on but
 * the ai clean vignette and ai button in landing page direct to login, instead
 * of to open the ai page so anonymous users can use."
 *
 * Exactly right, and it was the missing half. The switch, the guest quota, the
 * guest subject and the anonymous job path were all built; the two entry points
 * pointed at `/studio/ai`, which lives behind the Studio shell's auth redirect.
 * A signed-out visitor pressing "Try AI Clean" was sent to a login form.
 *
 * ── 🔴 THIS IS THE INDEXABLE ONE ────────────────────────────────────────────
 *
 * The original reason for a public Frenz AI page (2026-09-08): "make it
 * anonymous and so google adsense crawler can see it and so it can be indexed
 * in google". So this route is in the MARKETING group — real header, real
 * footer, crawlable, no auth read that would un-static it — and it is the one
 * with metadata and a canonical.
 *
 * `/studio/ai` stays as it is for signed-in members inside the Studio shell.
 * Both render the same `FrenzAIWelcome`, so there is one design and two doors.
 *
 * ── The switch is honoured, and it is the only thing that gates this ────────
 *
 * `frenzAiPublicEnabled` is what the owner turns off once AdSense has approved.
 * When it is off a signed-out visitor is sent to sign in — which is the old
 * behaviour, deliberately, because that is what "turn off Frenz AI from
 * unsigned in users" means.
 *
 * A signed-in member is never redirected either way: the switch is about
 * ANONYMOUS access, not about the feature.
 */
/**
 * ── 🔴 NOINDEX. FRENZ AI IS NOT A PUBLIC PRODUCT ANY MORE ───────────────────
 *
 * Owner, 2026-09-09, as a PERMANENT product rule: "AI must NOT be publicly
 * exposed as a major landing-page feature, indexed standalone page, or publicly
 * usable tool… Remove AI metadata/title/description from public SEO surfaces."
 *
 * This page carried a keyword-shaped title ("remove captions and text from your
 * videos"), a marketing description ending "no sign-up needed", a canonical and
 * a full Open Graph block — all of it correct under the previous rule, which
 * was to be crawlable for the AdSense review, and all of it now exactly what
 * the new rule forbids.
 *
 * What replaces it is the minimum a browser tab needs and nothing a search
 * engine can use:
 *
 *   · `robots: index/follow false` — a `Disallow` in robots.txt stops the
 *     fetch but NOT a URL-only listing from an external link, so the page has
 *     to say it itself;
 *   · no `canonical` — a canonical is an instruction about how to index
 *     something that should not be indexed;
 *   · no Open Graph — that block exists to make the page shareable into feeds
 *     and previews, which is public promotion by another route;
 *   · a plain, factual title with no keywords in it.
 *
 * ⚠️ Removing the metadata is NOT sufficient on its own, and the spec says so:
 * "Do not simply hide AI visually while leaving publicly indexable content
 * behind it." The route also has to stop serving content to anonymous
 * visitors — see the auth gate below.
 */
export const metadata: Metadata = {
  title: "Frenz AI",
  robots: { index: false, follow: false, nocache: true },
};

/*
  Statically generated with ISR, like every other marketing page. It reads the
  operator switch through the service-role client (no cookies, no headers), so
  nothing here opts the route out of static rendering — the same discipline
  `getLandingSettings` was built for.
*/
export const revalidate = 300;

export default async function PublicFrenzAIPage() {

  /*
    Off means off. Sending them to the signed-in route is right rather than
    showing a dead page: that route's own redirect takes them to login with a
    `next` that brings them back afterwards, so the journey still completes.
  */
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/studio/ai");


  return (
    <>
      <SiteHeader landing />
      <main
        className="container max-w-3xl px-3 pb-10 sm:pb-14"
        style={{ paddingTop: "calc(var(--frenz-header-bottom, 4rem) + 1rem)" }}
      >
        {/*
          `cleanHref` points at the PUBLIC workspace. Passing it rather than
          hard-coding one inside the component is what lets a single design
          serve both doors — the signed-in page passes nothing and gets the
          Studio route.
        */}
        <FrenzAIWelcome cleanHref="/ai/clean" historyHref="/ai/history" />
      </main>
      <SiteFooter />
    </>
  );
}
