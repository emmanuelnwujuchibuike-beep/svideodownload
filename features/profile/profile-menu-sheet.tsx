"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ProfileMenuBottomSheet } from "./profile-menu-bottom-sheet";
import { ProfileMenuPanel, type MenuUser } from "./profile-menu-panel";

/**
 * The profile menu as an OVERLAY, for the top-right header avatar (owner:
 * "the profile menu at the right top header to be identical with the one i
 * uploaded" — public/profilemenu.jpg). It renders the exact same
 * `ProfileMenuPanel` the profile page's docked panel and bottom sheet use.
 *
 * Presentation follows the surface: a bottom sheet on phones (the reference), a
 * panel anchored under the avatar on desktop, where a full-height sheet would be
 * absurd. Both are portaled to <body> because this trigger lives inside
 * overflow-constrained flex headers that clip an unportaled dropdown (the same
 * fix every other menu in the app already carries).
 *
 * ── Why this module is `import()`-ed, never imported statically ───────────────
 * It pulls in the ~50-language table, the theme toggle and the inbox cache. The
 * header is permanent chrome on every marketing page, so a static import would
 * put all of that on the landing's first-load JS and blow the 2-second budget —
 * exactly the regression the "code-split heavy header widgets" rule exists for.
 * A plain `import()` (not `next/dynamic ssr:false`, which never resolves here).
 */
export function ProfileMenuSheet({
  user,
  anchor,
  onClose,
}: {
  user: MenuUser;
  /** Viewport coords of the trigger, for the desktop anchored panel. */
  anchor: { top: number; right: number };
  onClose: () => void;
}) {
  // Mount first, then flip to the visible state on the next frame so the
  // transition actually runs (CSS, not framer-motion: this chunk is fetched on
  // tap, and the header has no other reason to pull an animation library in).
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const PANEL_WIDTH = 352; // w-88
  const left = Math.max(8, Math.min(anchor.right - PANEL_WIDTH, (typeof window === "undefined" ? 1024 : window.innerWidth) - PANEL_WIDTH - 8));

  return (
    <>
      {/* Phones — the reference's bottom sheet, shared with the profile page. */}
      <div className="lg:hidden">
        <ProfileMenuBottomSheet open user={user} onClose={onClose} />
      </div>

      {/* Desktop — the same panel, anchored under the avatar */}
      {createPortal(
        <div className="hidden lg:block">
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className={`fixed inset-0 z-[70] cursor-default bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Profile menu"
            style={{ top: anchor.top + 8, left, width: PANEL_WIDTH }}
            className={`fixed z-[80] flex max-h-[min(82vh,46rem)] origin-top-right flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-elevated transition duration-200 [transition-timing-function:var(--ease-out)] ${
              shown ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
          >
            <ProfileMenuPanel user={user} onNavigate={onClose} onClose={onClose} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
