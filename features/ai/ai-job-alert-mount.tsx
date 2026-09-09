"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { AI_JOB_STARTED_EVENT, browserHasUsedAiClean } from "@/lib/ai/history-cache";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ALERT'S DOOR — nothing is downloaded until there is a reason
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09 (the permanent Frenz AI rule, §25): "AI-specific code
 * should be lazy-loaded where appropriate. Do not load AI SDKs, AI dashboard
 * code, AI processing dependencies, usage history or balance data on the public
 * landing page. The landing page should remain lightweight."
 *
 * ── 🔴 IT WAS IMPORTED DIRECTLY, AND THE BUDGET TEST CAUGHT IT ──────────────
 *
 * `AiJobAlert` was mounted straight into both layouts. That put it — and
 * `lib/ai/client`, `lib/ai/jobs`, the notification copy and the sound engine —
 * into the initial bundle of EVERY route in both groups, including the landing
 * page and `/admin`. `lib/perf/budget.test.ts` failed on `/admin/page` going
 * over its 364 kB ceiling, which is a route the comments in that file note has
 * "deliberately almost no slack left".
 *
 * This wrapper is what stands in its place, and it is nearly free: two imports,
 * one state, one effect.
 *
 * ── 🔴 THE GATE COMES BEFORE THE IMPORT, NOT AFTER IT ───────────────────────
 *
 * The obvious version of this file is a `next/dynamic` call with `ssr: false`,
 * which splits the chunk out of the initial bundle but still FETCHES it on
 * every page load. That is better and not good enough: it is a network request
 * and a parse, on every visit, for a component that does nothing at all for
 * somebody who has never used Frenz AI.
 *
 * So `browserHasUsedAiClean()` — a single `localStorage` key check, no parse,
 * no network — decides whether the chunk is ever asked for. A first-time
 * visitor, and the AdSense crawler on the page being assessed, download nothing
 * and run nothing.
 *
 * The event is the other half: somebody cleaning their FIRST video has no cache
 * to be found, and they are precisely the person most likely to be waiting for
 * the result.
 */
const AiJobAlert = dynamic(
  () => import("@/features/ai/ai-job-alert").then((m) => m.AiJobAlert),
  {
    ssr: false,
    /*
      No loading state. This renders a banner that is absent until a job
      finishes — a placeholder would be a reserved space for something that is
      not coming, on every page of the site.
    */
  },
);

export function AiJobAlertMount() {
  /*
    Starts false on the server AND on the client's first paint, so hydration
    cannot mismatch: `localStorage` does not exist during SSR, and reading it
    during render would produce different markup on the two sides.
  */
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (browserHasUsedAiClean()) {
      setArmed(true);
      return;
    }
    /*
      Not armed yet. Listen for a job starting in this session — the first-video
      case — and arm then. One listener, removed on unmount, on a browser that
      is otherwise doing nothing about Frenz AI at all.
    */
    const onStarted = () => setArmed(true);
    window.addEventListener(AI_JOB_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(AI_JOB_STARTED_EVENT, onStarted);
  }, []);

  return armed ? <AiJobAlert /> : null;
}
