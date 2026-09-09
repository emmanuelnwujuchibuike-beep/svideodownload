import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AICleanWorkspace } from "@/features/ai/ai-clean-workspace";
import { AIDownloadOverlay } from "@/features/ai/ai-download-overlay";
import { getLandingSettings } from "@/lib/landing/settings";
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
  robots: { index: false, follow: true },
  alternates: { canonical: `${SITE_URL}/ai` },
};

// A live tool: it reads a session and a guest cookie on every request.
export const dynamic = "force-dynamic";

export default async function PublicAICleanPage() {
  const { frenzAiPublicEnabled } = await getLandingSettings();

  // Off means the anonymous door is closed; the Studio route sends them to
  // login with a `next` so the journey still completes.
  if (!frenzAiPublicEnabled) redirect("/studio/ai/clean");

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
