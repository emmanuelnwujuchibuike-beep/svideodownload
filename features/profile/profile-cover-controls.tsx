"use client";

import { Camera, LayoutGrid, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ProfileMenuBottomSheet } from "./profile-menu-bottom-sheet";
import type { MenuUser } from "./profile-menu-panel";

/**
 * The owner profile's floating cover controls.
 *
 * Owner (2026-08-03): "remove all buttons in the top header in the users profile
 * and move the search button and the profile menu button to float ontop of the
 * cover picture section like the edit profile, so the top header can be removed
 * to give a full edge to edge view to the safe area. Note the search and profile
 * menu button shouldn't go to the safe area."
 *
 * So the fixed top bar is gone entirely and the cover runs edge to edge under
 * the status bar. These controls float over it, offset by `--frenz-safe-top` so
 * the ARTWORK reaches the notch and the buttons never do. They also carry their
 * own scrim-free glass background, because a cover photo can be any brightness.
 *
 * `lg:hidden`: on a laptop the app shell's own sidebar and top bar provide all
 * of this, and the profile page docks its rail there instead.
 */
export function ProfileCoverControls({ user }: { user: MenuUser }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-3 lg:hidden"
        style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 0.75rem)" }}
      >
        <Link
          href="/search"
          aria-label="Search"
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 text-white backdrop-blur-md transition hover:bg-black/55 active:scale-95"
        >
          <Search className="h-5 w-5" />
        </Link>

        <div className="pointer-events-auto flex items-center gap-2">
          <Link
            href="/account/identity"
            className="inline-flex items-center gap-1.5 rounded-xl bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/55 active:scale-95"
          >
            <Camera className="h-4 w-4" /> Edit Cover
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Menu"
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 text-white backdrop-blur-md transition hover:bg-black/55 active:scale-95"
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
        </div>
      </div>

      <ProfileMenuBottomSheet open={open} user={user} onClose={() => setOpen(false)} />
    </>
  );
}
