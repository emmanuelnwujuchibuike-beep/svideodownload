"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { aiButtonClass } from "@/features/ai/design/ai-button";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { FrenzAIHistory } from "@/features/ai/frenz-ai-history";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";

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
export function FrenzAIHistoryPage({ base = "/ai", slides = [] }: { base?: "/ai" | "/studio/ai"; slides?: ShowcaseSlide[] }) {
  /*
    Redesign 2026-10-06 (owner's AI History reference): plain white, no frame;
    the showcase on large screens only; "AI History" with the gradient word
    and one line under it; the list (kind pills, day groups, media rows). The
    list lives ON THE DEVICE (lib/ai/history-store.ts) — entering this page
    asks the server nothing once this browser has synced.
  */
  return (
    <FrenzAIEnvironment stage="idle" bare className="relative">
      <div className="pb-10 pt-3">
        <AiShowcase slides={slides} base={base} desktopOnly className="mb-5" />
        <header className="px-1">
          <h1 className="font-brand text-[2.1rem] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[2.4rem]">
            AI <span className="text-gradient">History</span>
          </h1>
          <p className="mt-1.5 text-[15.5px] text-muted-foreground">Your creations, all in one place.</p>
        </header>

        {/*
          🔴 `showHeading={false}`: this page's own H1 already names it. The
          section renders its heading when it is a strip on another page and
          stays quiet when it IS the page — one component, two contexts.
        */}
        <FrenzAIHistory className="mt-4" showHeading={false} groupByDay />

        <div className="mt-8">
          <Link href={base} prefetch={false} className={aiButtonClass({ variant: "secondary", size: "sm", className: "ai-btn--round" })}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Frenz AI
          </Link>
        </div>
      </div>
    </FrenzAIEnvironment>
  );
}
