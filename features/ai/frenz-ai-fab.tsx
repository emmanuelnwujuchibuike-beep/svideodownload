"use client";

import { WandSparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI BUTTON — a floating circle, bottom right, on the history page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "put a floating circle premium Ai button bottom right
 * of all signed in pages thats stays at the bottom right when up, and it
 * should hide when scrolling down, sticks from scrolling up. The button
 * should always prefetch when the pages opens to click it opens the Ai
 * welcome page instantly without loading."
 *
 * Second pass, same day: "the Ai button shouldn't show on the landing feed
 * page and all unsigned in pages… it should be a more editing icon and the
 * widget should go under the bottom NAV when hiding not ontop the bottom NAV.
 * And the widget looks too simple."
 *
 * ── Signed in, or nothing ───────────────────────────────────────────────────
 *
 * The shells this mounts in also serve signed-out visitors (a public profile,
 * the feed), so the button reads the same signal the bottom nav's profile
 * tile reads — `useEntitlements().handle` — and draws nothing without one.
 * Not on `/feed` either, by name.
 *
 * ── Where it sits, and where it goes ────────────────────────────────────────
 *
 * Fixed, bottom right, 16px above the phone's bottom nav (`--frenz-bottomnav-h`,
 * 0 where there is no nav), 24px above the edge otherwise. `z-30` — BELOW the
 * nav's z-40 — so when scrolling down slides it off the bottom it passes
 * behind the nav, never over it; when it is up, it is clear of the nav anyway.
 * The same `useScrollDirection` store the nav reads: one scroll listener for
 * the whole shell.
 *
 * ── Instant open ────────────────────────────────────────────────────────────
 *
 * `/ai` is a static route, so `router.prefetch("/ai")` on mount puts its
 * whole RSC payload in the router cache; the tap is then a client
 * transition with nothing to fetch.
 *
 * Not on the AI pages themselves, nor on surfaces where a floating circle
 * sits on a composer or full-screen media: reels, a chat thread, the
 * creation flow.
 */
/*
  ── 🔴 ONLY ON THE HISTORY PAGE (owner, 2026-09-14: "Remove the AI button
  widget from all pages, it should only be on the history page") ─────────────

  What used to be a deny-list of surfaces is now an ALLOW-list of one:
  `/history`. The first cut also kept `/downloads` on the theory that it is
  the same history behind the app shell — the owner, same day: "the AI
  widget button still shows in the Download page". It is the Download page
  to the person using it, so it is off. Everywhere else draws nothing — the
  AI tools are reached from the bottom nav's profile hub and the Studio.
  The component is mounted ONLY by app/(marketing)/history/page.tsx now; the
  (app) and /u layouts no longer carry it, so no other page even loads it.
*/
const SHOWN_PREFIXES = ["/history"];

export function FrenzAiFab() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const dir = useScrollDirection();
  const { handle } = useEntitlements();
  const shown = !!handle && SHOWN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!shown) return;
    router.prefetch("/ai");
  }, [router, shown, pathname]);

  if (!shown) return null;

  return (
    <Link
      href="/ai"
      prefetch
      aria-label="Open Frenz AI"
      title="Frenz AI"
      onClick={() => haptic("light")}
      className={cn(
        /*
          ── 🔴 FLAT, AND STILL (owner, 2026-09-27) ──────────────────────────
          "make the Ai button widget in the history page to be light and
          professional like this, and no animation" — with a reference of one
          solid blue disc and a single white glyph.

          What went: a conic rim that turned for ever, a three-stop gradient,
          an inset gloss, an inner shadow, a hover lift and a white "AI"
          badge pinned to the corner. Each was defensible on its own and
          together they read as a toy on a page whose job is a list of files.

          What stays: the press feedback. `active:scale-95` is a response to
          a touch, not decoration — removing it would make the button feel
          dead rather than calm, and it costs nothing while idle.

          The slide-out-of-the-way transform stays for the same reason: it
          only runs when the page scrolls, and without it the button has to
          either cover content or disappear instantly.
        */
        "fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full sm:right-6",
        "bg-[#3b4ee8] text-white",
        "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none",
        "active:scale-95",
        dir === "down" && "translate-y-[calc(100%+var(--frenz-bottomnav-h,0px)+3rem)]",
      )}
      style={{ bottom: "max(1.5rem, calc(var(--frenz-bottomnav-h, 0px) + 1rem))" }}
    >
      <WandSparkles className="h-6 w-6" strokeWidth={2} />
      <span className="sr-only">Frenz AI</span>
    </Link>
  );
}
