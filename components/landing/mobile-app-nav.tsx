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
 * `MobileNav` is already mode/auth-aware on its own (useAppMode + a
 * signed-out-safe profile fallback), so it needs no props here — same as
 * this file's old call sites already invoked it, `<MobileAppNav />`.
 */
export { MobileNav as MobileAppNav } from "@/features/app-shell/mobile-nav";
