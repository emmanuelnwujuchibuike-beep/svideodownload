"use client";

import { ArrowRight, Bookmark, LogOut, MessageCircle, Sparkles, User as UserIcon, UserCircle } from "lucide-react";
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

  // While auth is still resolving, paint the last-known avatar rather than a
  // grey pulse (owner, 2026-07-16: "the profile button in message page at the
  // top ... still reloads on back swiped"). On a relaunched PWA this gate is
  // hit on every cold start, so the pulse WAS the reload the owner sees.
  // `realAvatarUrl` is seeded from the identity cache (lib/auth/identity-cache),
  // so if this browser has ever been signed in it's already here on frame one.
  // Purely cosmetic: the menu's contents still wait for the real session below,
  // and a signed-out visitor has no cached identity, so they never see a
  // stranger's face.
  if (loading) {
    return realAvatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={realAvatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
    ) : (
      <div className="h-9 w-9 animate-pulse rounded-full bg-secondary" />
    );
  }

  if (!user) {
    // A signed-in viewer must never be shown "Log in" because of a transient
    // auth blip (owner, 2026-07-16: "the login button thats in the landing page
    // flashes on the message page when i enter a chat and come out fast").
    //
    // `useUser()` resolves to `{ user: null, loading: false }` in two very
    // different situations: genuinely signed out, and a getUser() call that
    // FAILED (its catch clears `loading` without a user — a real, documented
    // race when a freshly-installed service worker claims the page mid-fetch).
    // This component can't tell those apart, so it used to render the
    // signed-out CTA for both, flashing a login button at someone who is very
    // much logged in.
    //
    // The identity cache settles it: if this browser has a cached identity, the
    // viewer HAS been signed in here, so keep showing their avatar and let the
    // auth listener correct it. A real sign-out clears that cache (see
    // use-user's onAuthStateChange), so a genuinely signed-out visitor still
    // gets the CTA immediately.
    if (realAvatarUrl) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={realAvatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />;
    }
    // Owner (2026-07-16): "change the login button in the landing page to login
    // or create account to access all features". The old "Log in for API" was
    // both narrower than the truth (an account unlocks the whole social app,
    // not just the REST API) and hid the fact that signing up happens through
    // this same passwordless flow — there is no separate register page.
    return (
      // Premium, alive login CTA. Simple copy + icon (owner). The motion is all
      // GPU (transform/opacity): a brand-gradient fill, a sheen that sweeps across
      // on hover, a soft glow that breathes, and a press-scale. The icon nudges on
      // hover. Everything inherits the global reduced-motion guard.
      <Link
        href="/login?next=/account"
        className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 hover:shadow-violet-500/50 active:scale-[0.97]"
      >
        {/* breathing glow behind the pill */}
        <span aria-hidden className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-500 opacity-40 blur-md motion-safe:animate-pulse" />
        {/* sheen sweep on hover */}
        <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full" />
        <Sparkles className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
        Get started
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
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
