"use client";

import { ArrowRight, Bookmark, Crown, Fingerprint, LogOut, Menu, MessageCircle, User as UserIcon, UserCircle, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { IconTile } from "@/components/icons/icon-tile";
import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { useUser } from "@/features/auth/use-user";
import { UserMenu } from "@/features/auth/user-menu";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getPrimaryPages } from "@/lib/seo/seo-pages";
import { cn } from "@/lib/utils";

/**
 * Marketing nav, per `public/main landing page.jpg`.
 *
 * Every entry resolves to a route that exists — the mockup's "Products" points at
 * the ecosystem grid on `/` rather than a `/products` page nobody has built, and
 * "Support" at the real contact route. Shipping a nav item that 404s is the same
 * class of defect the Reality Ledger exists to catch, just in the chrome instead
 * of the copy.
 */
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/#platforms", label: "Features" },
  { href: "/#products", label: "Products" },
  { href: "/#download", label: "Download" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Support" },
];

const DOWNLOADERS = getPrimaryPages();

/**
 * `social` hides the mobile hamburger + drawer: on in-app social surfaces
 * (profiles, posts) the bottom MobileNav already owns navigation, so the
 * marketing menu in the top-right is redundant and out of place there.
 *
 * `desktopHidden` hides the whole header on lg+ — used on profile pages where the
 * app shell (left sidebar + top bar) owns desktop nav, while this bar still
 * provides the mobile top bar.
 */
export function SiteHeader({ social = false, desktopHidden = false }: { social?: boolean; desktopHidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const { user, enabled } = useUser();
  const { handle } = useEntitlements();
  const { showAds, ready } = useShowAds();
  const isPremium = ready && !showAds;

  return (
    <>
    <header className={cn("fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)] backdrop-blur-xl", desktopHidden && "lg:hidden", social ? "border-b border-border/20 bg-background/60" : "border-b border-border/40 bg-background/85 supports-[backdrop-filter]:bg-background/70")}>
      <div className="container flex h-16 items-center justify-between">
        {/* Brand — hidden on mobile social surfaces (plain, full-bleed top bar) */}
        <Link href="/" className={cn("items-center", social ? "hidden lg:flex" : "flex")} onClick={() => setOpen(false)}>
          <FrenzWordmark size={32} priority />
        </Link>

        {/* Desktop nav — only at lg+; iPad-portrait (md) uses the roomy drawer so
            the bar never gets cramped. */}
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground lg:flex">
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
        <div className="hidden items-center gap-3 lg:flex">
          {!isPremium && (
            <Link
              href="/pricing"
              className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-all hover:shadow-amber-500/40 hover:shadow-lg active:scale-[0.98]"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <Crown className="h-4 w-4" /> Go Pro
            </Link>
          )}
          <ThemeToggle />
          <UserMenu />
        </div>

        {/* Mobile trigger — hidden on social surfaces (bottom nav owns nav there) */}
        {social ? null : (
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center lg:hidden"
          >
            {/* Same glass-tile treatment as the in-app topbar's search/create/
                notification icons — consistent premium chrome across every
                page, marketing or in-app. */}
            <IconTile>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</IconTile>
          </button>
        )}
      </div>
      </header>

      {/* Mobile drawer — right-side panel; left half of the page stays visible */}
      {open && !social && (
        <>
          {/* Backdrop over the exposed page area */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-0 top-16 z-40 bg-background/50 backdrop-blur-sm lg:hidden"
          />
          <div className="fixed bottom-0 right-0 top-16 z-50 w-[62%] min-w-[18rem] max-w-sm overflow-y-auto overscroll-contain border-l border-border/40 bg-background/97 shadow-2xl lg:hidden">
            <nav className="flex flex-col gap-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {/* Go Pro — top CTA, hidden for paying users */}
            {!isPremium && (
              <Link
                href="/pricing"
                onClick={() => setOpen(false)}
                className="group relative mb-2 flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-amber-500/25"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <Crown className="h-5 w-5" /> Go Pro — remove ads
              </Link>
            )}

            <Link
              href="/explore"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
            >
              Explore
            </Link>
            <Link
              href="/blog"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
            >
              Blog
            </Link>

            {/* Platform list — vertical, scrollable */}
            <p className="mt-3 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              Download from
            </p>
            <div className="mt-2 flex flex-col gap-2">
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
                  href={handle ? `/u/${handle}` : "/account#profile"}
                  onClick={() => setOpen(false)}
                  className="mt-2 flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
                >
                  <ModuleIconBadge icon={UserCircle} /> {handle ? "My profile" : "Set up profile"}
                </Link>
                <Link
                  href="/messages"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
                >
                  <ModuleIconBadge icon={MessageCircle} /> Messages
                </Link>
                <Link
                  href="/saved"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
                >
                  <ModuleIconBadge icon={Bookmark} /> Saved
                </Link>
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
                >
                  <ModuleIconBadge icon={UserIcon} /> Account
                </Link>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-muted-foreground transition hover:bg-secondary"
                  >
                    <ModuleIconBadge icon={LogOut} /> Sign out
                  </button>
                </form>
              </>
            ) : (
              /*
                Owner (2026-07-18): "the login button on mobile is still the old
                type … make the mobile button the same with the laptop login
                button with a more premium icon that means login."

                This now mirrors UserMenu's desktop CTA exactly — same brand
                gradient, same breathing glow, same hover sheen, same Fingerprint
                mark — differing only in being full-width, which the drawer is.
                It supersedes the 2026-07-16 two-line "log in or create account"
                wording: one control, one treatment, on every viewport.

                Fingerprint over KeyRound: it reads as authentication at a glance
                and is the more premium mark, which is what was asked for.
              */
              <Link
                href={enabled ? "/login?next=/account" : "/#download"}
                onClick={() => setOpen(false)}
                className="group relative mt-2 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 hover:shadow-violet-500/50 active:scale-[0.97]"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-500 opacity-40 blur-md motion-safe:animate-pulse"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full"
                />
                <Fingerprint className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                {enabled ? "Launch App" : "Get Started"}
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
            )}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
