"use client";

import {
  Crown,
  Download,
  History,
  Home,
  Images,
  LifeBuoy,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DESKTOP STUDIO SHELL — a sidebar, and only above `lg`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner's brief §6: "On desktop/tablet, use a professional application layout…
 * LEFT SIDEBAR — Frenz AI branding, Home, AI Studio, Downloads, Wallpapers,
 * Library, Pro, Settings, Help & Support. The sidebar should remain visually
 * quiet. The main content area should receive most visual attention."
 *
 * Until now there was no desktop navigation at all: every AI screen was the
 * phone layout stretched across a 1440px window, which is exactly what §4
 * forbids — "Do NOT simply make the desktop layout shrink down."
 *
 * ── 🔴 `lg`, AND THE NUMBER IS NOT ARBITRARY ────────────────────────────────
 *
 * The existing bottom navigation is `lg:hidden` (features/app-shell/mobile-nav
 * .tsx). Matching that exactly is what guarantees the two can never both be on
 * screen and can never both be absent. §5 is explicit that the mobile nav is
 * not to be casually redesigned, and §31 that the existing architecture is to
 * be preserved — so this adds a second navigation ABOVE the point the first one
 * leaves, and touches neither the nav nor the routes.
 *
 * ── Quiet on purpose ────────────────────────────────────────────────────────
 *
 * No colour on the rail, no gradients, no icons larger than the text they sit
 * beside. The one accent in the whole column is the active item's soft tint and
 * the Go Pro button, because §6 asks for the main content to hold the attention
 * and §49 asks for restraint over decoration.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  /** Also active for any deeper path under it. */
  deep?: boolean;
}

/**
 * The rail, in the brief's own order.
 *
 * 🔴 EVERY HREF IS AN EXISTING ROUTE. §7 — "Do not blindly add tools that do
 * not exist" — applies to navigation as much as to tool cards: a sidebar entry
 * pointing at a 404 is worse than one that is absent, because it looks like the
 * product lost a feature.
 */
const MAIN: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/ai", label: "AI Studio", icon: Sparkles, deep: true },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/wallpapers", label: "Wallpapers", icon: Images },
  { href: "/ai/history", label: "Library", icon: History },
  { href: "/account/plan", label: "Pro", icon: Crown },
];

const FOOT: NavItem[] = [
  { href: "/account", label: "Settings", icon: Settings },
  { href: "/help", label: "Help & Support", icon: LifeBuoy },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  /*
    `/ai` must not light up while the member is on `/ai/history`, which has its
    own entry — so a deep match still yields to a longer entry that matches too.
  */
  if (item.deep) {
    const deeper = [...MAIN, ...FOOT].some(
      (other) => other !== item && other.href.startsWith(item.href) && other.href.length > item.href.length && (pathname === other.href || pathname.startsWith(`${other.href}/`)),
    );
    if (deeper) return false;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}

export function AiStudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="lg:flex lg:items-start lg:gap-0">
      {/*
        `sticky`, not `fixed`: a fixed rail would need the main column padded by
        hand and would sit over the page during a back-swipe transition, which
        this project has been bitten by before. Sticky keeps it in flow.
      */}
      <aside
        aria-label="Frenz AI"
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/60 bg-white/60 px-3 py-5 backdrop-blur-xl lg:flex xl:w-64"
      >
        <Link href="/ai" className="mb-6 flex items-center gap-2.5 px-2">
          <FrenzLogo size={26} alt="" />
          <span className="text-[15.5px] font-bold tracking-[-0.02em]">Frenz AI</span>
        </Link>

        <nav className="flex-1">
          <ul className="space-y-0.5">
            {MAIN.map((item) => (
              <RailItem key={item.href} item={item} active={isActive(pathname, item)} />
            ))}
          </ul>

          <hr className="my-4 border-border/60" />

          <ul className="space-y-0.5">
            {FOOT.map((item) => (
              <RailItem key={item.href} item={item} active={isActive(pathname, item)} />
            ))}
          </ul>
        </nav>

        {/*
          The Go Pro card from the reference. The one saturated element in the
          column, and it is the only thing here that is trying to sell — which
          is why nothing else competes with it.
        */}
        <div className="mt-4 rounded-2xl bg-gradient-to-br from-violet-50 to-sky-50 p-3.5 ring-1 ring-inset ring-white">
          <p className="flex items-center gap-1.5 text-[13px] font-bold">
            <Crown className="h-3.5 w-3.5 text-violet-600" aria-hidden />
            Go Pro
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            More credits, premium features and faster processing.
          </p>
          <Link
            href="/account/plan"
            className="ai-cta mt-2.5 flex h-9 items-center justify-center rounded-full text-[13px] font-bold"
          >
            Upgrade
          </Link>
        </div>
      </aside>

      {/*
        `min-w-0` is load-bearing: without it a flex child refuses to shrink
        below its content's intrinsic width and a long title pushes the whole
        page into horizontal scroll — which §5 forbids outright.
      */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function RailItem({ item, active }: { item: NavItem; active: boolean }) {
  const { icon: Icon, href, label } = item;
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          // 44px tall — §26's touch target, honoured on desktop too so the rail
          // does not become the one place a trackpad has to be precise.
          "flex min-h-[44px] items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] transition-colors",
          active
            ? "bg-violet-50 font-semibold text-violet-700"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
        )}
      >
        <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-violet-600")} aria-hidden />
        {label}
      </Link>
    </li>
  );
}
