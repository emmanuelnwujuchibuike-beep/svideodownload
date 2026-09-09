import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FrenzAIWelcome } from "@/features/ai/frenz-ai-welcome";
import { getLandingSettings } from "@/lib/landing/settings";
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
export const metadata: Metadata = {
  title: "Frenz AI — remove captions and text from your videos",
  description:
    "Remove unwanted captions, subtitles and text overlays from your videos while keeping them looking natural. Free to try, no sign-up needed.",
  alternates: { canonical: `${SITE_URL}/ai` },
  openGraph: {
    title: "Frenz AI — remove captions and text from your videos",
    description:
      "Remove unwanted captions, subtitles and text overlays from your videos while keeping them looking natural.",
    url: `${SITE_URL}/ai`,
    type: "website",
  },
};

/*
  Statically generated with ISR, like every other marketing page. It reads the
  operator switch through the service-role client (no cookies, no headers), so
  nothing here opts the route out of static rendering — the same discipline
  `getLandingSettings` was built for.
*/
export const revalidate = 300;

export default async function PublicFrenzAIPage() {
  const { frenzAiPublicEnabled } = await getLandingSettings();

  /*
    Off means off. Sending them to the signed-in route is right rather than
    showing a dead page: that route's own redirect takes them to login with a
    `next` that brings them back afterwards, so the journey still completes.
  */
  if (!frenzAiPublicEnabled) redirect("/studio/ai");

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
