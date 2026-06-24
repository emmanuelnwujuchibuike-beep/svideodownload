"use client";

import { Crown, Download, KeyRound, LogOut, Menu, User as UserIcon, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useUser } from "@/features/auth/use-user";
import { UserMenu } from "@/features/auth/user-menu";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getPrimaryPages } from "@/lib/seo/seo-pages";

const NAV_LINKS = [
  { href: "/tiktok-video-downloader", label: "TikTok" },
  { href: "/instagram-reels-downloader", label: "Instagram" },
  { href: "/#features", label: "Features" },
  { href: "/developers", label: "API" },
  { href: "/blog", label: "Blog" },
];

const DOWNLOADERS = getPrimaryPages();

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user, enabled } = useUser();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 font-bold" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-400 text-white shadow-md shadow-blue-500/30">
            <Download className="h-4 w-4" />
          </span>
          <span className="text-[17px] tracking-tight">
            S<span className="text-gradient">Video</span>Download
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative transition-colors hover:text-foreground after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all hover:after:w-full"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Desktop right */}
        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/pricing"
            className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-all hover:shadow-amber-500/40 hover:shadow-lg active:scale-[0.98]"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Crown className="h-4 w-4" /> Go Pro
          </Link>
          <ThemeToggle />
          <UserMenu />
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-foreground backdrop-blur md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border/40 bg-background/97 md:hidden">
          <nav className="container flex flex-col gap-1 py-4">
            {/* Go Pro — top CTA */}
            <Link
              href="/pricing"
              onClick={() => setOpen(false)}
              className="group relative mb-2 flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-amber-500/25"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <Crown className="h-5 w-5" /> Go Pro — remove ads
            </Link>

            <Link
              href="/blog"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
            >
              Blog
            </Link>

            {/* Platform grid */}
            <p className="mt-3 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              Download from
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DOWNLOADERS.map((d) => {
                const platform = PLATFORMS[d.platformId];
                const Icon = BRAND_ICONS[d.platformId];
                return (
                  <Link
                    key={d.slug}
                    href={`/${d.slug}`}
                    onClick={() => setOpen(false)}
                    className="group flex items-center gap-2.5 rounded-xl border border-border/80 bg-card/90 p-2.5 transition hover:border-foreground/20 active:scale-[0.98]"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${platform.accent} text-white shadow-sm`}
                    >
                      {Icon ? <Icon className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold leading-tight">
                        {platform.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {d.thing}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-border/60 bg-card/60 p-3">
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
                href={enabled ? "/login?next=/account" : "/#download"}
                onClick={() => setOpen(false)}
                className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 text-center text-base font-semibold text-primary-foreground shadow-md shadow-primary/25 transition hover:shadow-primary/40"
              >
                {enabled ? (
                  <>
                    <KeyRound className="h-5 w-5" /> Log in for API &amp; more
                  </>
                ) : (
                  "Get Started"
                )}
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
