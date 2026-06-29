"use client";

import { Bookmark, Compass, Home, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Create", href: "/downloads", icon: Plus, primary: true },
  { label: "Chat", href: "/messages", icon: MessageCircle },
  { label: "Saved", href: "/saved", icon: Bookmark },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border/60 bg-background/90 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur-xl lg:hidden">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        if (item.primary) {
          return (
            <Link key={item.label} href={item.href} aria-label={item.label} className="flex flex-col items-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/30">
                <item.icon className="h-5 w-5" />
              </span>
            </Link>
          );
        }
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
