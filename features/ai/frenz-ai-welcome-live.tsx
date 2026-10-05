"use client";

import { ArrowRight, History, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { aiButtonClass } from "@/features/ai/design/ai-button";
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
  children,
}: {
  exploreHref: string;
  historyHref: string;
  /** Rendered after the allowance, inside the environment — the trust row. */
  footer: ReactNode;
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
        /*
          ── THE SHARED GROUND (owner, 2026-09-27) ─────────────────────────
          `.ai-wash` is the one light iridescent wash every AI page sits on,
          defined once in globals.css.
        */
        className="ai-wash relative overflow-hidden rounded-[1.75rem]"
      >
        <div className="px-4 pb-6 pt-5 sm:px-6 sm:pt-6">
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
          <div className="pointer-events-auto flex gap-2">
            <Link
              href={exploreHref}
              data-ai-members=""
              className={aiButtonClass({ size: "lg", className: "relative min-w-0 flex-1 overflow-hidden" })}
            >
              <Sparkles className="h-[18px] w-[18px] shrink-0 opacity-90" aria-hidden />
              <span className="truncate">Create with AI</span>
              <span className="ai-btn__icon-end flex shrink-0" aria-hidden>
                <ArrowRight className="h-[18px] w-[18px]" />
              </span>
              <LinkPendingStripe />
            </Link>
            {/*
              Icon-only below `sm`: on a 320–430 px phone two labelled buttons
              split the row and the PRIMARY's label was the one cut off
              ("Create …", measured 2026-10-05). The primary keeps the row; the
              name stays on the link for a screen reader.
            */}
            <Link
              href={historyHref}
              // Not prefetched: this door is new (2026-10-05) and on /studio/ai
              // its target is a dynamic route — a viewport prefetch would be a
              // server render on EVERY welcome visit. The primary door above
              // keeps its prefetch (owner, 2026-09-14: doors open instantly).
              prefetch={false}
              data-ai-members=""
              aria-label="Your creations"
              className={aiButtonClass({ variant: "secondary", size: "lg", className: "w-[3.375rem] shrink-0 px-0 sm:w-auto sm:px-5" })}
            >
              <History className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
              <span className="hidden sm:inline">Your creations</span>
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
