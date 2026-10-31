"use client";

import { ArrowRight, History } from "lucide-react";
import Link from "next/link";

import { TapOnceLink } from "@/features/ui/tap-once-link";
import { useEffect, useState, type ReactNode } from "react";

import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAIAllowanceBar } from "@/features/ai/frenz-ai-chrome";
import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
import { getAiEntitlement, type AiMemberEntitlement } from "@/lib/ai/client";
import {
  readAiEntitlementCache,
  writeAiEntitlementCache,
} from "@/lib/ai/entitlement-cache";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/**
 * The welcome page's ONE live island (features/ai/frenz-ai-welcome.tsx is the
 * server half). Everything here needs the member's entitlement: the allowance
 * bar, the "not available" line and whether the actions dock is drawn at all.
 * The hero, the showcase slides and the trust row arrive as server-rendered
 * children, so they cost no hydration of their own.
 *
 * ── 🔴 A GUEST NEVER ASKS ──────────────────────────────────────────────────
 * Since 2026-10-05 a signed-out visitor may see this page. The entitlement
 * endpoint refuses them anyway, so asking would be a Vercel invocation for a
 * guaranteed "no" on every guest view. `hasAuthCookie()` is a cookie read —
 * no cookie, no request.
 */
export function FrenzAIWelcomeLive({
  exploreHref,
  historyHref,
  footer,
  hero,
  children,
}: {
  exploreHref: string;
  historyHref: string;
  /** Rendered after the allowance, inside the environment — the ad card. */
  footer: ReactNode;
  /** Step 16 (2026-10-19): the full-bleed featured carousel, above everything and outside the page's top padding. */
  hero?: ReactNode;
  children: ReactNode;
}) {
  /*
    Painted from the last answer first (owner, 2026-09-13: "this section
    reloads every time I enter the page or backswipe"). The network still
    replaces it on every mount; the cache puts the plan chip on screen at the
    first frame. See lib/ai/entitlement-cache.ts.
  */
  const [entitlement, setEntitlement] = useState<AiMemberEntitlement | null>(null);

  useEffect(() => {
    if (!hasAuthCookie()) return;
    let alive = true;
    // In the effect, not the initial state: the prerendered markup has no
    // entitlement, and an initial state that differs from it is a hydration
    // mismatch. The cached paint lands one frame after hydration.
    const cached = readAiEntitlementCache();
    if (cached) setEntitlement((current) => current ?? cached);
    void getAiEntitlement().then((res) => {
      // A refusal is not an error worth showing here: the page is entirely usable without it.
      if (alive && res.ok) {
        const { ok: _ok, ...view } = res;
        const next = view as unknown as AiMemberEntitlement;
        setEntitlement(next);
        writeAiEntitlementCache(next);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Until the entitlement answers the studio is drawn as open: "not available" is a claim about a switch nobody has read yet.
  const available = entitlement ? entitlement.offered : true;

  return (
    <>
      <FrenzAIEnvironment
        stage="idle"
        // bare: the ambient light was the faint grey band behind the showcase (measured 2026-10-05); plain white means none
        bare
        /*
          ── PLAIN WHITE, NO FRAME (owner, 2026-10-05, with the reference) ──
          This was a rounded, overflow-hidden card painted with the iridescent
          wash. The reference puts the content straight on the page and the
          owner asked for plain white, so the frame, its clipping and its inner
          padding are gone — the showcase now bleeds to the screen edge as in
          the reference, which a clipping frame would have cut off.
        */
        className="ai-wash relative"
      >
        {hero}
        <div className={hero ? "pb-6" : "pb-6 pt-3 sm:pt-4"}>
          {children}

          {/*
            The allowance (reference: "14 of 15 free cleans left today"). It
            renders nothing for a guest, a paid-only or an unlimited plan, so it
            cannot invent a limit nobody is under.
          */}
          <FrenzAIAllowanceBar entitlement={entitlement} className="mt-5" />

          {!available ? (
            <p className="mt-5 rounded-[0.875rem] bg-secondary px-5 py-3.5 text-center text-[13.5px] font-semibold text-muted-foreground">
              Not available right now. Check back soon.
            </p>
          ) : null}

          {footer}
        </div>
      </FrenzAIEnvironment>

      {/*
        ── THE ACTIONS, ALWAYS IN REACH ─────────────────────────────────────
        Owner, 2026-09-21: "make the Explore AI Studio button stick on top of
        the bottom nav … even when the user scrolls down or up, and it
        shouldn't obstruct the write-up much." Kept: `sticky`, docked at
        `--frenz-bottomnav-h`, OUTSIDE the overflow-hidden environment (a
        sticky child of an overflow-hidden box sticks to that box).

        Redesign 2026-10-05: the shared button system — one primary (Create
        with AI) and one quiet secondary (Your creations) — instead of the
        animated pill. Both carry `data-ai-members`: for a guest they open the
        sign-in dialog (AiMembersGate) instead of a login redirect.
      */}
      {available ? (
        <div
          className="pointer-events-none sticky z-20 -mx-1 -mb-3 px-1 pb-3 pt-7"
          style={{
            bottom: "var(--frenz-bottomnav-h, 0px)",
            background: "linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background) / 0.92) 55%, transparent 100%)",
          }}
        >
          {/*
            Step 16 (design/AIStudio.dc.html, 2026-10-19): the big gradient "Create with AI →" (the page's one
            primary action) and a round History button beside it — glass, because the page scrolls under it.
            "Create with AI" opens the AI Studio. Both keep data-ai-members (a guest gets the sign-in dialog).
          */}
          <div className="pointer-events-auto flex gap-2">
            <Link
              href={exploreHref}
              data-ai-members=""
              className="relative flex h-[60px] min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full bg-frenz-gradient-x font-heading text-[17px] font-bold text-white no-underline shadow-frenz-float transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2"
            >
              <span className="truncate">Create with AI</span>
              <ArrowRight className="h-5 w-5 shrink-0" aria-hidden />
              <LinkPendingStripe />
            </Link>
            <TapOnceLink
              href={historyHref}
              spinner={false}
              warmOnIdle={hasAuthCookie()}
              data-ai-members=""
              aria-label="Your creations"
              className="frenz-nav-glass frenz-nav-glass--static flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full text-frenz-ink transition active:scale-95 data-[pending]:scale-95"
            >
              <History className="h-[22px] w-[22px] [[data-pending]>&]:animate-spin [[data-pending]>&]:text-frenz-violet motion-reduce:animate-none" aria-hidden />
            </TapOnceLink>
          </div>
        </div>
      ) : null}
    </>
  );
}
