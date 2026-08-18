import { MobileNav } from "@/features/app-shell/mobile-nav";

/**
 * The marketing pages' bottom nav — the SAME component the signed-in app
 * shell uses (owner, 2026-08-16: "the landing page bottom nav didnt change,
 * only the signed in download page, others pages doesnt, i want it shared
 * accross all just like the previous bottom nav").
 *
 * This used to be a second, hand-maintained copy of the whole nav — its own
 * NavTab, its own active-glyph colors, its own item lists — kept in sync by
 * hand with features/app-shell/mobile-nav.tsx. That is exactly how a style
 * pass can land on one and not the other: this file's redesign never
 * happened because nobody was told two files needed the same edit. Re-
 * exporting the one real component means there is only one place a future
 * nav change can be made, and it is applied everywhere by construction.
 *
 * 🔴 `marketing` (2026-08-18): landing and the SEO downloader pages kept
 * disagreeing about whether this nav showed Reels or Feed, because that
 * decision depended on the VIEWER's own `mode` cookie — a signed-in visitor
 * carrying `mode=full` from browsing the actual app landed on a completely
 * different tab set (Full Bleed's, which always shows Reels). `marketing`
 * pins every page in this group to the simple, Feed-not-Reels set
 * unconditionally, so it is IDENTICAL for every visitor regardless of mode
 * or sign-in state — confirmed via AskUserQuestion before changing this,
 * since it overrides the 2026-08-16 "tab set depends only on mode" rule
 * specifically for these public marketing pages.
 */
export function MobileAppNav() {
  return <MobileNav marketing />;
}
