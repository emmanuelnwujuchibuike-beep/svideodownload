"use client";

import { Bookmark, KeyRound, LogOut, MessageCircle, User as UserIcon, UserCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";

import { MyDiamondCrownBadge } from "@/components/badges/my-diamond-crown-badge";
import { ModuleIconBadge } from "@/components/icons/module-icon-badge";

import { useEntitlements } from "./use-entitlements";
import { useUser } from "./use-user";

/** Desktop header auth control: "Sign in" when logged out, avatar menu in. */
export function UserMenu() {
  const { user, loading, enabled } = useUser();
  const { handle, avatarUrl: realAvatarUrl } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 224; // w-56

  // Portal-rendered + position computed on open (not a plain `absolute
  // right-0 mt-2` sibling) — this button sits inside scrollable/flex-
  // constrained headers on several pages (the mobile Messages header among
  // them), and an unportaled dropdown there got squeezed/clipped by the
  // ancestor's own overflow/width instead of floating free — the same class
  // of bug already fixed this same way on every other menu in the app
  // (ConversationRow's row menu, NotificationCard's menu, etc.).
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(rect.right - MENU_WIDTH, margin), window.innerWidth - MENU_WIDTH - margin);
    setMenuPos({ top: rect.bottom + 8, left });
    setOpen(true);
  };

  // Supabase not configured → keep the original primary CTA.
  if (!enabled) {
    return (
      <Link
        href="/#download"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Get Started
      </Link>
    );
  }

  if (loading) {
    return <div className="h-9 w-9 animate-pulse rounded-full bg-secondary" />;
  }

  if (!user) {
    return (
      <Link
        href="/login?next=/account"
        title="Log in to use the REST API and sync your downloads"
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        <KeyRound className="h-4 w-4" /> Log in for API
      </Link>
    );
  }

  const email = user.email ?? "";
  // The REAL Frenz profile picture (profiles.avatar_url via useEntitlements),
  // not user_metadata.avatar_url — that field is only ever set by an OAuth
  // provider (Google sign-in) and is null for an email/OTP account even
  // after they upload a real profile picture in account settings. Falls
  // back to the OAuth one only if the profile picture itself isn't set yet.
  const avatar = realAvatarUrl ?? (user.user_metadata?.avatar_url as string | undefined) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center overflow-visible rounded-full ring-1 ring-border transition hover:ring-foreground/30"
      >
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-secondary">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            // A real profile icon, not a letter initial (owner correction,
            // 2026-07-14) — no picture set is a genuinely common, normal
            // state, not something to paper over with a fake-looking avatar.
            <UserCircle className="h-full w-full text-muted-foreground" strokeWidth={1.5} />
          )}
        </span>
        {/* Diamond Crown overlaps the avatar for premium/business viewers */}
        <MyDiamondCrownBadge size="xs" className="absolute -bottom-1 -right-1 ring-2 ring-background" />
      </button>

      {open && menuPos
        ? createPortal(
            <>
              {/* Full-screen invisible close target — the menu is portaled to
                  document.body now, so it's no longer a DOM descendant of the
                  trigger button; a document-level "click outside" listener
                  would need to special-case the portal instead of just
                  matching the app's existing pattern for this exact class of
                  menu (ConversationRow/NotificationCard use the same trick). */}
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div
                role="menu"
                style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
                className="fixed z-50 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated"
              >
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate text-xs text-muted-foreground">{email}</span>
            <MyDiamondCrownBadge size="sm" showLabel />
          </div>
          <Link
            href={handle ? `/u/${handle}` : "/account#profile"}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-secondary"
          >
            <ModuleIconBadge icon={UserCircle} className="h-6 w-6 rounded-lg" /> {handle ? "My profile" : "Set up profile"}
          </Link>
          <Link
            href="/messages"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-secondary"
          >
            <ModuleIconBadge icon={MessageCircle} className="h-6 w-6 rounded-lg" /> Messages
          </Link>
          <Link
            href="/saved"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-secondary"
          >
            <ModuleIconBadge icon={Bookmark} className="h-6 w-6 rounded-lg" /> Saved
          </Link>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-secondary"
          >
            <ModuleIconBadge icon={UserIcon} className="h-6 w-6 rounded-lg" /> Account
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <ModuleIconBadge icon={LogOut} className="h-6 w-6 rounded-lg" /> Sign out
            </button>
          </form>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
