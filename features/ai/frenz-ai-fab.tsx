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

  What used to be a deny-list of surfaces is now an ALLOW-list of one: the
  download history, in both of its doors (`/history` in the marketing shell,
  `/downloads` in the app shell). Everywhere else draws nothing — the AI
  tools are reached from the bottom nav's profile hub and the Studio.
*/
const SHOWN_PREFIXES = ["/downloads", "/history"];

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
        "group fixed right-4 z-30 flex h-[60px] w-[60px] items-center justify-center rounded-full text-white sm:right-6",
        "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none",
        "active:scale-95 motion-safe:hover:-translate-y-0.5",
        dir === "down" && "translate-y-[calc(100%+var(--frenz-bottomnav-h,0px)+3rem)]",
      )}
      style={{ bottom: "max(1.5rem, calc(var(--frenz-bottomnav-h, 0px) + 1rem))" }}
    >
      {/* the conic rim — a slow-turning light on the edge of the disc */}
      <span aria-hidden className="frenz-fab-rim pointer-events-none absolute inset-0 rounded-full" />
      {/* the disc */}
      <span
        aria-hidden
        className={cn(
          // No drop shadow (owner, 2026-09-14: "remove the shadow from the Ai button widget") — the rim and the gloss carry the depth.
          "absolute inset-[3px] rounded-full bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500",
          "shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_-6px_14px_rgb(0_0_0/0.18)_inset]",
        )}
      />
      {/* the gloss */}
      <span aria-hidden className="pointer-events-none absolute inset-[3px] rounded-full bg-[radial-gradient(60%_45%_at_50%_18%,rgb(255_255_255/0.45),transparent_70%)]" />
      <WandSparkles className="relative h-[26px] w-[26px] drop-shadow-[0_1px_1px_rgb(0_0_0/0.3)]" strokeWidth={2.1} />
      {/* the "AI" badge */}
      <span
        aria-hidden
        className="absolute -right-0.5 -top-0.5 rounded-full border border-white/70 bg-white px-1.5 py-[1px] text-[9px] font-black leading-none tracking-[0.06em] text-indigo-600"
      >
        AI
      </span>
      <span className="sr-only">Frenz AI</span>
    </Link>
  );
}
