"use client";

import { LogOut, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useUser } from "./use-user";

/** Desktop header auth control: "Sign in" when logged out, avatar menu in. */
export function UserMenu() {
  const { user, loading, enabled } = useUser();
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
        href="/login"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Sign in
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
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full ring-1 ring-border transition hover:ring-foreground/30"
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
            {initial}
          </span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-elevated"
        >
          <div className="truncate px-3 py-2 text-xs text-muted-foreground">
            {email}
          </div>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-secondary"
          >
            <UserIcon className="h-4 w-4" /> Account
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
