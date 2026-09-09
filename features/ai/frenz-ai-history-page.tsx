"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { FrenzAIHistory } from "@/features/ai/frenz-ai-history";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HISTORY PAGE — every video this visitor has made
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "the clean a video widget is in AI page instead of the
 * history page, and I still don't see the AI history button and page in the AI
 * landing page so users can see all their video edits they made even non signed
 * in users."
 *
 * ── 🔴 A PAGE, NOT A SECTION. I BUILT THE WRONG SHAPE TWICE. ────────────────
 *
 * The first attempt put history at the bottom of the welcome page and the owner
 * could not find it. The second moved it up the same page — and it was still a
 * strip under a hero, competing with the thing the hero is selling. Both were
 * answers to "where does this fit on the existing screen", when the actual
 * request was for a DESTINATION: somewhere to go and look at your work.
 *
 * So it has a route, a title, a breadcrumb and a way back, and the AI page has
 * a button that points at it. The floating "Clean a video" widget lives HERE,
 * which is what the owner asked for and is also where it belongs: this is the
 * page you scroll, so this is the page that needs the action pinned.
 *
 * ── 🔴 GUESTS TOO, AND THAT NEEDED NO NEW BACKEND ──────────────────────────
 *
 * "even non signed in users." Already true and already safe:
 * `resolveAiSubject` issues a signed, HttpOnly guest id, `subjectScope` filters
 * every read by it, and `GET /api/ai/jobs` has been subject-scoped since Part 2.
 * A guest sees their own jobs and cannot name anybody else's, because the
 * identifier is HMAC-signed and they have never seen the key.
 *
 * What was missing was, again, a door.
 */
export function FrenzAIHistoryPage() {
  return (
    <FrenzAIEnvironment stage="idle" className="relative overflow-hidden rounded-[1.75rem]">
      {/* the room's light — static, and well under the text */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 40% at 20% 0%, rgba(99,102,241,0.10) 0%, transparent 62%)," +
            "radial-gradient(60% 40% at 92% 26%, rgba(217,70,239,0.08) 0%, transparent 66%)",
        }}
      />

      <div className="px-4 pb-10 pt-5 sm:px-6">
        <FrenzAICrumb tool="Your videos" />

        <h1 className="mt-4 text-[1.9rem] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[2.2rem]">
          Your <span className="text-gradient">videos</span>
        </h1>
        <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
          Everything you&apos;ve cleaned with Frenz AI. Finished videos stay here for three days,
          so you can come back for them.
        </p>

        {/*
          🔴 `showHeading={false}`: this page's own H1 already says "Your
          videos". The section renders its heading when it is a strip on another
          page and stays quiet when it IS the page — one component, two
          contexts, rather than a second copy of the list.
        */}
        <FrenzAIHistory className="mt-6" showHeading={false} groupByDay />

        <div className="mt-8">
          <Link
            href="/ai"
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Frenz AI
          </Link>
        </div>
      </div>


    </FrenzAIEnvironment>
  );
}
