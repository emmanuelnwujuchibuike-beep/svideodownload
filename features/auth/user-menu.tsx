"use client";

import { Bookmark, KeyRound, LogOut, MessageCircle, User as UserIcon, UserCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MyDiamondCrownBadge } from "@/components/badges/my-diamond-crown-badge";
import { ModuleIconBadge } from "@/components/icons/module-icon-badge";

import { useEntitlements } from "./use-entitlements";
import { useUser } from "./use-user";

/** Desktop header auth control: "Sign in" when logged out, avatar menu in. */
export function UserMenu() {
  const { user, loading, enabled } = useUser();
  const { handle } = useEntitlements();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  const initial = (email || "U").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center overflow-visible rounded-full ring-1 ring-border transition hover:ring-foreground/30"
      >
        <span className="h-full w-full overflow-hidden rounded-full">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
              {initial}
            </span>
          )}
        </span>
        {/* Diamond Crown overlaps the avatar for premium/business viewers */}
        <MyDiamondCrownBadge size="xs" className="absolute -bottom-1 -right-1 ring-2 ring-background" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated backdrop-blur-md"
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
      ) : null}
    </div>
  );
}
