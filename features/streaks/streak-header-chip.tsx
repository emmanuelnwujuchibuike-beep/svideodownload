"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { readDisplayCache, useStreak } from "@/features/streaks/use-streak";
import { tierFor } from "@/lib/streaks/tiers";
import { cn } from "@/lib/utils";

/*
  Code-split, and fetched on the FIRST TAP. The panel carries six live tier
  marks and a CSS-heavy layout, and the landing page is held to a first-load
  ceiling by lib/perf/budget.test.ts. Nothing in it is needed to paint a pill.
*/
const StreakDetailsPanel = dynamic(
  () => import("@/features/streaks/streak-details-panel").then((m) => m.StreakDetailsPanel),
  { ssr: false },
);

const StreakTiersSheet = dynamic(
  () => import("@/features/streaks/streak-tiers-sheet").then((m) => m.StreakTiersSheet),
  { ssr: false },
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE STREAK, IN THE HEADER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08, with a marked-up screenshot: "Streak in Header (Compact) —
 * clean, compact and always visible without taking focus from the main action",
 * and "Tap to View Streak Details — opens a beautiful, premium panel with your
 * streak info, flame gallery and motivation."
 *
 * ── 🔴 IT MOVED OUT OF THE HERO, WHICH IS THE POINT ─────────────────────────
 *
 * `StreakHeroIndicator` put it in the hero, on the row with Fast / Secure /
 * Private, directly under the headline. That is the most valuable space on the
 * page and it belongs to the thing the page is for — pasting a link. A streak
 * is a returning-visitor detail: worth seeing, never worth competing with the
 * primary action. In the header it is always visible on every page and in the
 * way on none of them.
 *
 * ── ZERO CLS, WHICH IS WHY IT PAINTS FROM A CACHE FIRST ─────────────────────
 *
 * Same discipline as the chip it replaces, and it matters more here because the
 * header is above the fold on every route. A pill that appeared when a fetch
 * resolved would shift the header's right cluster after paint — exactly what
 * CLS measures. So a returning visitor's number renders in the FIRST client
 * render from the localStorage display cache, and the network response only
 * corrects it in place. A first-time visitor has no cache, renders nothing, and
 * gets their pill next visit. No shift either way.
 */
/**
 * 🔴 THE ONLY THREE HEADERS THAT CARRY IT.
 *
 * Owner, 2026-09-08: “it should be on the landing page and it should not show
 * on other pages top header only the landing page, profile page and the
 * download page.”
 *
 * The rule lives HERE rather than at the two call sites, and that is the whole
 * point of putting it in the component. The chip is rendered by TWO different
 * headers — `SiteHeader` for the marketing routes and `AppTopbar` for the
 * signed-in shell — and between them they cover most of the app: /features,
 * /pricing, /blog, /help, /account, /u/… and every other route would have shown
 * it. Two call sites each holding half a rule is how they drift; one list that
 * both consult cannot.
 *
 *   /            the landing page   (SiteHeader)
 *   /profile     the doorway page   (SiteHeader) — NOT the signed-in dashboard
 *   /downloads   the download hub   (AppTopbar)
 *
 * Exact matches. `/profile` is the marketing profile doorway; `/u/<handle>` is
 * somebody ELSE’s profile and has no business showing you your own streak.
 */
const STREAK_ROUTES = new Set(["/", "/profile", "/downloads"]);

/**
 * The gate is a separate component, so the rule cannot land after the hooks.
 *
 * Hooks cannot live behind a condition: a route check written INSIDE the chip
 * would necessarily run after `useStreak()` and `readDisplayCache()`. Splitting
 * it means those only exist on the three routes that show the chip.
 *
 * ── ⚠️ WHAT THIS DOES *NOT* SAVE ────────────────────────────────────────────
 *
 * It does not save a request, and an earlier version of this comment claimed it
 * did. Measured against a production build on 2026-09-08: /api/streak is called
 * exactly twice on EVERY route — including the ones excluded here — because
 * `StreakTracker` (features/app-shell/deferred-shell.tsx) mounts app-wide and
 * does one GET plus the POST that records the day. And `useQuery` de-dupes by
 * key, as features/data documents: "five components mounting = ONE fetch". So
 * an inline gate would have cost nothing extra either.
 *
 * What the split actually buys is one subscriber, one localStorage read and one
 * render fewer on ~40 routes, and a shape where the rule PHYSICALLY cannot be
 * written after a hook. That is worth the extra function; a fabricated
 * performance number is not.
 */
export function StreakHeaderChip({ className }: { className?: string }) {
  const pathname = usePathname();

  // A trailing slash is the same route; a query string never reaches usePathname.
  const route = pathname !== "/" && pathname?.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (!route || !STREAK_ROUTES.has(route)) return null;

  return <StreakChip className={className} />;
}

function StreakChip({ className }: { className?: string }) {
  // `useState(initialiser)` runs during the first render, so the cached number
  // is on screen in the same commit as the rest of the header.
  const [cached] = useState<number | null>(() => readDisplayCache());
  const { data } = useStreak();
  /*
    🔴 ONE overlay at a time — "panel" or "gallery", never both.

    They used to nest, so dismissing the gallery revealed the panel still
    underneath and read as a tap that did nothing (owner, 2026-09-08). A single
    value cannot express "both open", which is what makes that impossible now
    rather than merely fixed.
  */
  const [view, setView] = useState<"none" | "panel" | "gallery">("none");

  const streak = data?.currentStreak ?? cached ?? 0;

  // Nothing to celebrate, nothing to render. The header is byte-for-byte what
  // it was for a first-time visitor.
  if (streak <= 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setView("panel")}
        aria-label={`${streak} day streak. View details`}
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1",
          // The reference's gradient: amber into rose into fuchsia.
          "bg-gradient-to-r from-amber-400 via-orange-500 to-fuchsia-500",
          "text-white shadow-[0_6px_18px_-6px_rgb(244_63_94/0.8)]",
          "transition active:scale-95",
          className,
        )}
      >
        <StreakFlameMark tier={tierFor(streak)} className="h-5 w-5" effects={false} />
        <span className="text-[13px] font-extrabold tabular-nums leading-none">{streak}</span>
      </button>

      {view === "panel" ? (
        <StreakDetailsPanel
          streak={streak}
          onClose={() => setView("none")}
          onOpenGallery={() => setView("gallery")}
        />
      ) : null}

      {view === "gallery" ? (
        <StreakTiersSheet streak={streak} onClose={() => setView("none")} />
      ) : null}
    </>
  );
}
