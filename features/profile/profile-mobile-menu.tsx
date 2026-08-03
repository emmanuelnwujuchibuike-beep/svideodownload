"use client";

import { Bell, type LucideIcon, Menu, MessageCircle, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FrenzWordmark } from "@/components/brand/frenz-logo";

import { ProfileMenuBottomSheet } from "./profile-menu-bottom-sheet";
import type { MenuUser } from "./profile-menu-panel";

function IconLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link href={href} aria-label={label} className="flex h-10 w-10 items-center justify-center text-foreground">
      <Icon className="h-[22px] w-[22px]" />
    </Link>
  );
}

/**
 * The profile's MOBILE top bar (owner: "mobile view doesnt have a menu or menu
 * toggle … the premium menu is not there"). Opaque + safe-area padded so it never
 * covers the cover. Desktop uses the app sidebar/top bar, so this is `lg:hidden`.
 *
 * The hamburger opens the SHARED profile menu — the same sheet the header avatar
 * and the profile page's own trigger open. It used to open a drawer of its own,
 * with a different nav list, a different "My Spaces" and its own Premium card,
 * which is why rebuilding the profile menu to the owner's reference appeared to
 * change nothing on the owner's own profile: this is the menu they were opening.
 */
export function ProfileMobileMenu({ user }: { user: MenuUser }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Safe-area padding sits OUTSIDE a fixed-height bar — never as padding
          inside a fixed h-14 (that squeezes the wordmark/icons up into the
          notch and down over the page, the "header goes into the safe areas"
          bug). Total height = safe-top + the 3.5rem bar. */}
      {/* Pure, opaque bg-background — no blur/transparency, matching every
          other top bar in the app (owner, 2026-08: remove the glass/floating
          look from the web chrome; reserve it for a future native app). */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/40 bg-background pt-[var(--frenz-safe-top)] lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/home" className="flex items-center">
            <FrenzWordmark size={28} textClassName="text-base" priority />
          </Link>
          <div className="flex items-center gap-0.5">
            <IconLink href="/search" label="Search" icon={Search} />
            <IconLink href="/notifications" label="Notifications" icon={Bell} />
            <IconLink href="/messages" label="Messages" icon={MessageCircle} />
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="ml-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 text-foreground"
            >
              <Menu className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>
      </header>

      <ProfileMenuBottomSheet open={open} user={user} onClose={() => setOpen(false)} />
    </>
  );
}
