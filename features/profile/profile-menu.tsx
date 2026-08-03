"use client";

import { LayoutGrid } from "lucide-react";
import { useState } from "react";

import { ProfileMenuBottomSheet } from "./profile-menu-bottom-sheet";
import { ProfileMenuPanel, type MenuUser } from "./profile-menu-panel";

/**
 * Profile menu — the owner's premium control center (owner reference:
 * public/profilemenu.jpg). The CONTENT lives in `./profile-menu-panel` and the
 * mobile presentation in `./profile-menu-bottom-sheet`, so this, the profile
 * page's mobile top bar and the header avatar all open the same menu.
 *
 * On desktop (lg+) it's an always-open panel docked on the right; on mobile it's a
 * bottom sheet opened from a top-right button.
 */
export function ProfileMenu(user: MenuUser) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop dock — always-open panel alongside the content. */}
      <aside className="hidden shrink-0 lg:block lg:w-72">
        <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col overflow-hidden border-l border-border/60 bg-gradient-to-b from-card/70 to-card/30 backdrop-blur-xl">
          <ProfileMenuPanel user={user} />
        </div>
      </aside>

      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        className="fixed right-3 top-[calc(0.75rem+var(--frenz-safe-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-xl bg-background/70 text-foreground ring-1 ring-inset ring-border/60 backdrop-blur-xl transition hover:bg-secondary lg:hidden"
      >
        <LayoutGrid className="h-[18px] w-[18px]" />
      </button>

      <div className="lg:hidden">
        <ProfileMenuBottomSheet open={open} user={user} onClose={() => setOpen(false)} />
      </div>
    </>
  );
}
