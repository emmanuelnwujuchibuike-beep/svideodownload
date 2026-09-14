"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI BUTTON — a floating circle, bottom right, on every signed-in page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "put a floating circle premium Ai button bottom right
 * of all signed in pages thats stays at the bottom right when up, and it
 * should hide when scrolling down, sticks from scrolling up. The button
 * should always prefetch when the pages opens to click it opens the Ai
 * welcome page instantly without loading."
 *
 * ── Where it sits ───────────────────────────────────────────────────────────
 *
 * Fixed, bottom right, ABOVE the phone's bottom nav: the nav publishes its
 * measured height as `--frenz-bottomnav-h` (0 where it is not mounted), so
 * the circle rides 16px over it on a phone and 24px over the home indicator
 * or the desktop's edge. `z-[45]`: over page content and the nav (z-40),
 * under every sheet and overlay (z-90+), so a modal always covers it.
 *
 * ── Hide on scroll down, return on scroll up ────────────────────────────────
 *
 * The same `useScrollDirection` store the bottom nav already reads — one
 * scroll listener for the whole shell, not a second one — and the same
 * eased transform, so the two move as one piece of chrome. "Down" slides it
 * off the bottom edge; "up" (or the top of the page) brings it back.
 *
 * ── Instant open ────────────────────────────────────────────────────────────
 *
 * `/ai` is a static route, so `router.prefetch("/ai")` on mount puts its
 * whole RSC payload in the router cache; the tap is then a client
 * transition with nothing to fetch. `<Link prefetch>` would do the same
 * only once the link is in the viewport — it always is, but the explicit
 * call runs the moment the page opens regardless, which is what was asked.
 *
 * Not on the AI pages themselves (it would point at the page it is on), nor
 * on surfaces where a floating circle sits on a composer or full-screen
 * media: reels, a chat thread, the creation flow.
 */
const HIDDEN_PREFIXES = ["/ai", "/studio/ai", "/reels", "/messages/", "/create", "/wallpapers"];

export function FrenzAiFab() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const dir = useScrollDirection();
  const shown = !HIDDEN_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));

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
        "group fixed right-4 z-[45] flex h-14 w-14 items-center justify-center rounded-full text-white sm:right-6",
        "bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500",
        "shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_16px_36px_-12px_rgb(99_102_241/0.85)]",
        "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none",
        "active:scale-95 motion-safe:hover:-translate-y-0.5",
        dir === "down" && "translate-y-[calc(100%+var(--frenz-bottomnav-h,0px)+2rem)]",
      )}
      style={{ bottom: "max(1.5rem, calc(var(--frenz-bottomnav-h, 0px) + 1rem))" }}
    >
      {/* the gloss, and a soft halo that breathes on hover only */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/35 via-white/5 to-transparent" />
      <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full bg-gradient-to-br from-blue-500/40 to-fuchsia-500/40 opacity-0 blur-md transition-opacity group-hover:opacity-100" />
      <Sparkles className="relative h-6 w-6 drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]" strokeWidth={2.25} />
      <span className="sr-only">Frenz AI</span>
    </Link>
  );
}
