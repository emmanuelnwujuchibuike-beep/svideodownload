"use client";

import { UserCircle } from "lucide-react";
import Link from "next/link";
import { type ComponentType, useState } from "react";

import { MyDiamondCrownBadge } from "@/components/badges/my-diamond-crown-badge";
import type { MenuUser } from "@/features/profile/profile-menu-panel";

import { useEntitlements } from "./use-entitlements";
import { useUser } from "./use-user";

type SheetComponent = ComponentType<{
  user: MenuUser;
  anchor: { top: number; right: number };
  onClose: () => void;
}>;

/**
 * Header auth control: a login CTA when logged out, the avatar in.
 *
 * Tapping the avatar opens the SAME premium profile menu the profile page uses
 * (owner: "the profile menu at the right top header to be identical with the one
 * i uploaded" — public/profilemenu.jpg). The sheet and everything it pulls in
 * (language table, theme toggle, inbox cache) is `import()`-ed on tap, because
 * this control is permanent chrome on every marketing page and a static import
 * would put all of it on the landing's cold-entry first-load JS.
 */
export function UserMenu() {
  const { user, loading, enabled } = useUser();
  const { handle, avatarUrl: realAvatarUrl, displayName, plan, verified } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [Sheet, setSheet] = useState<SheetComponent | null>(null);

  // The sheet is portaled to <body> and positioned from the trigger's own rect —
  // this button sits inside scrollable/flex-constrained headers on several pages
  // (the mobile Messages header among them), where an unportaled dropdown got
  // squeezed/clipped by the ancestor's overflow instead of floating free.
  const toggle = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ top: rect.bottom, right: rect.right });
    if (!Sheet) {
      try {
        const mod = await import("@/features/profile/profile-menu-sheet");
        setSheet(() => mod.ProfileMenuSheet);
      } catch {
        return; // chunk failed to load — leave the avatar inert rather than break the header
      }
    }
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
    /*
      Owner (2026-08-04): "what I meant by remove the fingerprint button from
      the top is to remove it ENTIRELY — users will only use the login button
      in the menu."

      So a signed-out visitor gets no header CTA at all. The single way in is
      the menu, which is why the menu button now renders on desktop as well
      (see site-header.tsx) — without that, removing this would have left a
      signed-out visitor on a laptop with no route to sign in anywhere.

      The signed-IN branch below is untouched: the avatar is not a CTA, it is
      how you reach your own account.
    */
    return null;
  }


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

      {open && anchor && Sheet ? (
        <Sheet
          user={{
            handle: handle ?? "",
            // Fall back through the honest options rather than inventing a name:
            // profile display name → handle → the email's local part.
            displayName: displayName || handle || (user.email ?? "").split("@")[0] || "You",
            avatarUrl: avatar,
            plan,
            verified,
          }}
          anchor={anchor}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
