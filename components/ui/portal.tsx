"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into `<body>`, escaping every ancestor.
 *
 * ── 🔴 THE BUG THIS EXISTS TO KILL (owner, 2026-08-24, twice) ──────────────
 * First on the friend-request sheet, then on the per-creator notification
 * sheet: "an unprofessional square" — a hard-edged grey rectangle behind the
 * card instead of a full-screen dim.
 *
 * The markup in both cases was correct: `fixed inset-0` with a scrim SHOULD
 * cover the viewport. It does not when any ancestor establishes a containing
 * block, and four common properties do that — `transform`, `filter`,
 * `backdrop-filter` and `will-change`. `position: fixed` then resolves against
 * that ancestor's box instead of the viewport, so the scrim is clipped to it:
 * square corners, ending partway down the screen.
 *
 * Profile pages are full of exactly those properties (blurred hero chrome, the
 * living-glow layer), which is why both reports came from there. But the fix
 * cannot be "find the offending ancestor and remove it" — any future blur
 * anywhere above re-introduces it silently, and the symptom appears on a
 * component nobody touched. A portal removes the whole class of bug: with
 * `<body>` as the only ancestor, no page can reach it.
 *
 * ── Why it renders nothing on the server ───────────────────────────────────
 * `document` does not exist during server render. Returning null until mounted
 * is also correct behaviour rather than a workaround: every consumer here is a
 * modal or overlay that is closed on first paint anyway, so nothing visible is
 * being deferred.
 *
 * Same trap already recorded for the messaging menus
 * ([[messaging-ui-verification-bugs]]) and worked around ad-hoc in
 * `wow-burst.tsx` — this is that workaround, made shared.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
