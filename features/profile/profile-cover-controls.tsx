"use client";

import { Camera, LayoutGrid, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

import type { MenuUser } from "./profile-menu-panel";

import { Portal } from "@/components/ui/portal";
import { useBodyScrollLocked } from "@/lib/dom/use-body-scroll-locked";

// Was a plain static import — ~32kB of profile-menu UI, its full nav icon
// set, and (transitively, via the Language row) the entire ~50-locale
// message catalogue, all riding into every profile page's first load
// regardless of whether the menu was ever opened. No `ssr: false`: nothing
// inside renders until `open` is true, matching UserMenu's own on-tap
// `import()` for the identical desktop control.
const ProfileMenuBottomSheet = dynamic(() => import("./profile-menu-bottom-sheet").then((m) => m.ProfileMenuBottomSheet));

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
  const [ready, setReady] = useState(false);

  /*
    🔴 THESE BUTTONS MUST LEAVE WHEN SOMETHING OPENS OVER THE PROFILE
    (owner, 2026-08-25, with a screenshot: "the profile nav also show when i
    click on a reels or feed post in profile, covering the reels buttons").

    Tapping a post in the grid does NOT navigate — `ReelViewer`/`ImageViewer`
    mount in place (features/social/profile-media-grid.tsx), so this page stays
    mounted underneath. These controls are `fixed`, portalled to <body>, and
    `z-[70]`; the viewer's own top chrome is `z-[60]` inside a `z-[85]` root.
    Portalled to the same parent, the two are siblings, so "Edit Cover" landed
    squarely on top of the viewer's For You / Following tabs.

    Raising the viewer or lowering these would only move the collision to the
    next overlay. The real statement is "page-owned chrome yields while an
    overlay covers the page", which is what the body-scroll-lock convention
    already means everywhere else in this app (lib/dom/scroll-lock.ts, and
    edge-swipe-back.tsx already decides on it). So it covers the image viewer,
    the post viewer and any future one for free — not just reels.

    The BUTTONS unmount; the component does not return early. The menu sheet
    below is our own child, and an early return would unmount it mid-open — the
    sheet would close itself the instant it locked the body.
  */
  const covered = useBodyScrollLocked();

  return (
    <>
      {/*
        🔴 FIXED + PORTALLED, so they stay pinned while the profile scrolls
        (owner, 2026-08-24: "make this three buttons in profile float and stick
        to the top when scrolling").

        They were `absolute` inside the cover section, so they scrolled away
        with the artwork — reachable only by scrolling back to the very top,
        which on a long profile is the whole page.

        The portal is not optional here. A `fixed` element resolves against the
        nearest ancestor carrying `transform`, `filter`, `backdrop-filter` or
        `will-change`, and this page has several (the blurred hero chrome, the
        living-glow layer) — plus the page-transition wrapper is transformed for
        the duration of every navigation and the whole time a back-swipe is
        being dragged. Any one of those would pin these buttons to a box that is
        itself moving, which is precisely the clipped-overlay bug reported twice
        already. With `<body>` as the only ancestor they are pinned to the
        viewport, unconditionally. See components/ui/portal.tsx.

        Their existing `bg-black/40 backdrop-blur-md` was already built to sit
        on a cover photo of any brightness, so it reads correctly over page
        content too once they are no longer over the artwork.
      */}
      {covered ? null : (
      <Portal>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex items-start justify-between px-3 lg:hidden"
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
            onClick={() => {
              setReady(true);
              setOpen(true);
            }}
            aria-label="Menu"
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 text-white backdrop-blur-md transition hover:bg-black/55 active:scale-95"
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
        </div>
      </div>
      </Portal>
      )}

      {ready ? <ProfileMenuBottomSheet open={open} user={user} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
