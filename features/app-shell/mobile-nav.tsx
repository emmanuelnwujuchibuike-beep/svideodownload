"use client";

import { Clapperboard, Compass, Home, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { openUpload } from "@/features/create/upload-store";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { cn } from "@/lib/utils";

const LEFT = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Explore", href: "/explore", icon: Compass },
];
const RIGHT = [{ label: "Reels", href: "/explore", icon: Clapperboard }];

export function MobileNav() {
  const pathname = usePathname();
  const { handle } = useEntitlements();
  const profileHref = handle ? `/u/${handle}` : "/account";
  const profileActive = pathname.startsWith("/u/") || pathname.startsWith("/account");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border/60 bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur-xl lg:hidden">
      {LEFT.map((item) => (
        <NavTab key={item.label} {...item} active={pathname === item.href} />
      ))}

      {/* TikTok-style center create button */}
      <button type="button" onClick={openUpload} aria-label="Create" className="relative -mt-1 flex h-8 w-[3.25rem] items-center justify-center">
        <span aria-hidden className="absolute inset-0 -translate-x-1 rounded-[0.7rem] bg-cyan-400" />
        <span aria-hidden className="absolute inset-0 translate-x-1 rounded-[0.7rem] bg-fuchsia-500" />
        <span className="relative flex h-8 w-[3.25rem] items-center justify-center rounded-[0.7rem] bg-white text-black shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </button>

      {RIGHT.map((item) => (
        <NavTab key={item.label} {...item} active={pathname === item.href && item.href !== "/explore"} />
      ))}

      {/* Profile (Instagram-style avatar) */}
      <Link href={profileHref} className="flex flex-col items-center gap-0.5 px-2 py-1">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-white ring-2 transition", profileActive ? "ring-primary" : "ring-transparent")}>
          <User className="h-3.5 w-3.5" />
        </span>
        <span className={cn("text-[10px] font-medium", profileActive ? "text-foreground" : "text-muted-foreground")}>Profile</span>
      </Link>
    </nav>
  );
}

function NavTab({ label, href, icon: Icon, active }: { label: string; href: string; icon: typeof Home; active: boolean }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 px-2 py-1">
      <Icon className={cn("h-6 w-6 transition", active ? "fill-current text-foreground" : "text-muted-foreground")} strokeWidth={active ? 2.5 : 2} />
      <span className={cn("text-[10px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}
