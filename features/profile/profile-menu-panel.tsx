"use client";

import { Crown, Film, Headset, ImageIcon, LogOut, Music, Settings, UsersRound, X, BrainCircuit } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentType, useEffect } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { LanguageSettingRow } from "@/components/i18n/language-setting-row";
import { ThemeToggle } from "@/components/theme-toggle";
import { BookmarkIcon, ChevronRightIcon, CompassIcon, DownloadIcon, MegaphoneIcon } from "@/features/frenz-ui/icons";
import { Avatar, VerifiedBadge } from "@/features/frenz-ui/primitives";
import { CoinMenuCardLazy as CoinMenuCard } from "@/features/wallet/coin-entry-lazy";
import { signOutClient } from "@/lib/auth/sign-out";
import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * The profile menu's CONTENT (design/Menu.dc.html, owner 2026-10-18): "Menu" with a close button,
 * the profile card, a Shortcuts grid, a "More" list, and a footer with Light / Dark / Auto and sign
 * out. One component for every place the menu opens — the header avatar's sheet, the profile page's
 * sheet and the desktop panel — so they can never drift apart.
 *
 * Home and Chats are not here: they are in the tab bar (owner). Every item is a real route.
 *
 * ── Kept off the cold-entry budget ────────────────────────────────────────────
 * This module pulls in the language table and the theme toggle. The header's trigger must therefore
 * `import()` its sheet on tap rather than import it statically — see `features/auth/user-menu.tsx`.
 */

export interface MenuUser {
  /** Empty when the viewer hasn't picked one yet — the identity card then points at setup. */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  plan: BillingPlan;
  verified: boolean;
}

type Icon = ComponentType<{ className?: string; size?: number }>;

/** The design's eight shortcuts, each to a route that exists. */
const SHORTCUTS: { label: string; href: string; icon: Icon; showcase?: true }[] = [
  { label: "Explore", href: "/explore", icon: CompassIcon },
  { label: "Reels", href: "/reels", icon: Film },
  { label: "Sounds", href: "/sounds", icon: Music },
  { label: "Friends", href: "/friends", icon: UsersRound },
  { label: "Downloads", href: "/downloads", icon: DownloadIcon },
  { label: "Saved", href: "/saved", icon: BookmarkIcon },
  { label: "Wallpapers", href: "/wallpapers", icon: ImageIcon },
  /*
    The design labels this "AI Studio". The product is named Frenz AI (owner, 2026-09-07), so it
    keeps its name. The one gradient tile in the grid — the AI showcase the gradient rule allows.
  */
  { label: "Frenz AI", href: "/studio/ai", icon: BrainCircuit, showcase: true },
];

/** "More": My ads, Settings, Help & support (owner 2026-10-18 — Support moved here from the footer). */
const MORE: { label: string; href: string; icon: Icon }[] = [
  { label: "My ads", href: "/advertise/campaigns", icon: MegaphoneIcon },
  { label: "Settings", href: "/account", icon: Settings },
  { label: "Help & support", href: "/support", icon: Headset },
];

export function ProfileMenuPanel({
  user,
  onNavigate,
  onClose,
}: {
  user: MenuUser;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const router = useRouter();

  /*
    Warm every destination the moment the menu opens (owner: "make all the pages in the profile menu
    … prefetch instantly as soon as the menu opens"). The panel only mounts when the sheet opens, so
    this effect IS "on open". Only ever mounted behind a tap by a signed-in member.
  */
  useEffect(() => {
    for (const s of SHORTCUTS) router.prefetch(s.href);
    for (const m of MORE) router.prefetch(m.href);
    if (user.handle) router.prefetch(`${profilePath(user.handle)}`);
    if (user.plan === "free") router.prefetch("/account/plan");
  }, [router, user.handle, user.plan]);

  const signOut = async () => {
    onClose?.();
    await signOutClient();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="frenz-ui flex h-full min-h-0 flex-col text-frenz-ink">
      <div className="flex items-center justify-between pl-5 pr-3 pt-2.5">
        <h2 className="m-0 font-heading text-[22px] font-extrabold tracking-[-0.6px]">Menu</h2>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-full">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
              <X className="h-[18px] w-[18px]" aria-hidden />
            </span>
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* the profile card — white, a hairline; the avatar keeps the identity ring */}
        <Link
          href={user.handle ? `${profilePath(user.handle)}` : "/account/identity"}
          onClick={onNavigate}
          className="mx-4 mt-3.5 flex items-center gap-3.5 rounded-[22px] border border-frenz-line bg-frenz-card p-3.5 transition active:scale-[0.99]"
        >
          <Avatar src={user.avatarUrl} name={user.displayName} size={56} ring online />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-heading text-lg font-bold">{user.displayName}</span>
              {user.verified ? <VerifiedBadge size={16} /> : null}
              {user.plan !== "free" ? <DiamondCrownBadge plan={user.plan} size="xs" /> : null}
            </span>
            <span className="truncate text-sm text-frenz-muted">{user.handle ? `@${user.handle} · View profile` : "Set up your profile"}</span>
          </span>
          <ChevronRightIcon size={18} className="shrink-0 text-frenz-muted" />
        </Link>

        {/* Frenz Coin Part 5 ("Where the wallet lives", Entry 2): the wallet card under the profile — nothing while Frenz Coin is off */}
        <CoinMenuCard onNavigate={onNavigate} />

        <h3 className="m-0 px-5 pb-2.5 pt-5 text-[13px] font-bold text-frenz-muted">Shortcuts</h3>
        <ul className="mx-4 grid grid-cols-4 gap-x-2 gap-y-3.5">
          {SHORTCUTS.map(({ label, href, icon: I, showcase }) => (
            <li key={href}>
              <Link href={href} onClick={onNavigate} className="flex flex-col items-center gap-1.5 text-center text-xs font-semibold transition active:scale-95">
                <span
                  className={cn(
                    "flex h-[58px] w-[58px] items-center justify-center rounded-[18px]",
                    showcase ? "bg-frenz-gradient text-white" : "bg-frenz-fill text-frenz-violet",
                  )}
                >
                  <I className="h-6 w-6" size={24} />
                </span>
                <span className="w-full truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <h3 className="m-0 px-5 pb-2 pt-[22px] text-[13px] font-bold text-frenz-muted">More</h3>
        <ul className="mx-4 overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
          {MORE.map(({ label, href, icon: I }, i) => (
            <li key={href} className={cn(i > 0 && "border-t border-frenz-line")}>
              <Link href={href} onClick={onNavigate} className="flex min-h-[54px] items-center gap-3 px-3.5 transition active:bg-frenz-fill">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-frenz-violet/10 text-frenz-violet">
                  <I className="h-[18px] w-[18px]" size={18} />
                </span>
                <span className="flex-1 text-base font-semibold">{label}</span>
                <ChevronRightIcon size={16} className="text-frenz-muted" />
              </Link>
            </li>
          ))}
          {/* Go Premium stays for a free account — the menu was its only door outside Settings */}
          {user.plan === "free" ? (
            <li className="border-t border-frenz-line">
              <Link href="/account/plan" onClick={onNavigate} className="flex min-h-[54px] items-center gap-3 px-3.5 transition active:bg-frenz-fill">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-frenz-violet/10 text-frenz-violet">
                  <Crown className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="flex-1 text-base font-semibold">Go Premium</span>
                <ChevronRightIcon size={16} className="text-frenz-muted" />
              </Link>
            </li>
          ) : null}
        </ul>

        {/* Language stays one tap away, as before (Settings has it too) */}
        <div className="mx-4 mt-3">
          <LanguageSettingRow className="rounded-[20px] border border-frenz-line bg-frenz-card" />
        </div>
      </div>

      {/* Footer — Light / Dark / Auto and sign out */}
      <div className="flex items-center gap-2.5 border-t border-frenz-line px-4 pb-4 pt-3">
        <ThemeToggle variant="segmented" className="flex-1" />
        <button
          type="button"
          onClick={() => void signOut()}
          aria-label="Sign out"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700 transition active:scale-95 dark:bg-rose-500/15 dark:text-rose-300"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}
