import type { ReactNode } from "react";

import { AiRail } from "@/features/ai/design/ai-rail";
import { AiGenerationCardMount } from "@/features/ai/video/generation-card-mount";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DESKTOP STUDIO SHELL — a sidebar, and only above `lg`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner's brief §6: "On desktop/tablet, use a professional application layout…
 * LEFT SIDEBAR — Frenz AI branding, Home, AI Studio, Downloads, Wallpapers,
 * Library, Pro, Settings, Help & Support. The sidebar should remain visually
 * quiet. The main content area should receive most visual attention."
 *
 * Until now there was no desktop navigation at all: every AI screen was the
 * phone layout stretched across a 1440px window, which is exactly what §4
 * forbids — "Do NOT simply make the desktop layout shrink down."
 *
 * ── 🔴 A SERVER COMPONENT, AND THAT IS THE WHOLE POINT ──────────────────────
 *
 * Owner, 2026-09-28: "the Frenz AI button now takes time to respond when
 * clicked and it takes time to load, it shows more of white screen."
 *
 * The first version of this file was `"use client"` at the top AND rendered
 * `{children}`. A client component that renders its children puts the entire
 * subtree behind its own bundle — every AI page had to wait for this file,
 * lucide's icon set and `usePathname` to hydrate before it could paint. That is
 * the white screen, and it was a regression I introduced.
 *
 * Split in two, `children` stay server-rendered and stream immediately. The
 * rail (`./ai-rail`) is the only interactive part, so it is the only client
 * part, and it is `hidden` below `lg` — a phone never downloads a navigation it
 * cannot see.
 *
 * ── `lg`, AND THE NUMBER IS NOT ARBITRARY ───────────────────────────────────
 *
 * The existing bottom navigation is `lg:hidden` (features/app-shell/mobile-nav
 * .tsx). Matching that exactly is what guarantees the two can never both be on
 * screen and can never both be absent. §5 says the mobile nav is not to be
 * casually redesigned and §31 that the existing architecture is preserved — so
 * this adds a second navigation ABOVE the point the first one leaves, and
 * touches neither the nav nor the routes.
 */
export function AiStudioShell({ children }: { children: ReactNode }) {
  return (
    <div className="lg:flex lg:items-start">
      <AiRail />
      {/*
        `min-w-0` is load-bearing: without it a flex child refuses to shrink
        below its content's intrinsic width, and one long title pushes the whole
        page into horizontal scroll — which §5 forbids outright.
      */}
      <div className="min-w-0 flex-1">{children}</div>
      {/*
        The running generation, on every AI screen. It is portalled to <body>,
        so its position in this tree affects nothing but which routes mount it
        — and mounting it HERE rather than in the root layouts is what keeps it
        off the landing page's bundle (the rule `AiJobAlertMount` exists for).
      */}
      <AiGenerationCardMount />
    </div>
  );
}
