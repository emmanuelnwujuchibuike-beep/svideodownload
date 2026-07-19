"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useUser } from "@/features/auth/use-user";

/**
 * Sends signed-in visitors from `/` to `/home`.
 *
 * ── Why this moved out of middleware ─────────────────────────────────────────
 *
 * This redirect used to live in `middleware.ts`. It was the ONLY cookie-
 * conditional redirect on `/`, and that single fact stopped the landing page
 * being edge-cacheable. Measured on the live site:
 *
 *     /        x-vercel-cache: MISS    Cache-Control: private, no-cache, no-store
 *              (no `x-nextjs-prerender` header at all — served from the origin)
 *     /about   x-vercel-cache: STALE   Cache-Control: public
 *              x-nextjs-prerender: 1
 *
 * Every other prerendered route served from the cache; `/` alone went to the
 * origin on every single request. That is what produced a TTFB swinging between
 * 799ms and 4752ms, and an LCP of 2484-6360ms on the one page that has to be
 * fastest — the cold entry point for every new visitor, governed by the
 * 2-second budget.
 *
 * ── The trade ────────────────────────────────────────────────────────────────
 *
 * A signed-in visitor who opens `/` now sees the landing page for a moment
 * before being replaced to `/home`, instead of never seeing it. That is a real
 * regression for them, and it is the right way round: signed-in users arrive at
 * `/home` through the app and rarely hit `/` at all, while `/` is the first
 * thing every prospective user loads. Making the many fast is worth a blink for
 * the few — and the blink is short precisely because the page is now cached.
 *
 * `useUser()` adds no request: the header already calls it on this page.
 *
 * SHARE TARGET is the exception, and it fails SILENTLY if forgotten. The
 * manifest posts shared links to `/` as a GET with `?url=`/`?text=`, and the
 * paste-a-link tool that handles them lives here. Redirecting those would
 * swallow every "share into Frenz" from a signed-in user — which is most of
 * them. Keep in sync with `lib/share-target.ts` and manifest.ts's
 * `share_target.action` if the tool ever moves.
 */
export function SignedInLandingRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, enabled } = useUser();

  const isShareTarget = params.has("url") || params.has("text");

  useEffect(() => {
    if (!enabled || !user || isShareTarget) return;
    router.replace("/home");
  }, [enabled, user, isShareTarget, router]);

  return null;
}
