"use client";

import { Download, LogOut, Menu, User as UserIcon, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useUser } from "@/features/auth/use-user";
import { UserMenu } from "@/features/auth/user-menu";

const NAV_LINKS = [
  { href: "/tiktok-video-downloader", label: "TikTok" },
  { href: "/instagram-reels-downloader", label: "Instagram" },
  { href: "/#features", label: "Features" },
  { href: "/blog", label: "Blog" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user, enabled } = useUser();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 text-white">
            <Download className="h-4 w-4" />
          </span>
          <span className="text-lg">
            S<span className="text-gradient">Video</span>Download
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <UserMenu />
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-border/40 bg-background/95 backdrop-blur-xl md:hidden">
          <nav className="container flex flex-col gap-1 py-4">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
              >
                {l.label}
              </Link>
            ))}

            <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-card/60 p-3">
              <span className="text-sm font-medium text-muted-foreground">Appearance</span>
              <ThemeToggle />
            </div>

            {/* Auth */}
            {enabled && user ? (
              <>
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="mt-2 flex items-center gap-2 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
                >
                  <UserIcon className="h-5 w-5" /> Account
                </Link>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-base font-medium text-muted-foreground transition hover:bg-secondary"
                  >
                    <LogOut className="h-5 w-5" /> Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link
                href={enabled ? "/login" : "/#download"}
                onClick={() => setOpen(false)}
                className="mt-2 rounded-xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground"
              >
                {enabled ? "Sign in" : "Get Started"}
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
