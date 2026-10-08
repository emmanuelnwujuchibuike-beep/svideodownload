import type { LucideIcon } from "lucide-react";
import { Clapperboard, Megaphone, Users, Wand2 } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const card = "rounded-[1.75rem] bg-card ring-1 ring-inset ring-black/[0.07] shadow-[0_10px_30px_-24px_rgba(30,40,90,0.4)] dark:ring-white/10";

/*
  The two big tiles right above this row are Frenz AI and Wallpapers, so the
  row carries the OTHER doors — the same door twice on one screen is the
  clutter §23 forbids. Four equal columns: fits a 320px phone without scrolling.
*/
const QUICK: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/reels", label: "Reels", icon: Clapperboard },
  { href: "/reels?tab=ai", label: "AI Reels", icon: Wand2 },
  { href: "/feed", label: "Feed", icon: Users },
  { href: "/advertise", label: "Promote", icon: Megaphone },
];

/**
 * §5: "a compact set of high-value shortcuts … only expose the most important
 * destinations". One row of five, icon over a short word, that scrolls rather
 * than wraps on a narrow phone. Download itself is the hero right above.
 */
export function QuickActions({ promote, className }: { promote: boolean; className?: string }) {
  const items = promote ? QUICK : QUICK.filter((q) => q.href !== "/advertise");
  return (
    <nav aria-label="Explore Frenzsave" className={className}>
      <ul className={cn("grid gap-2", items.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              prefetch={false}
              className={cn(card, "flex flex-col items-center gap-1.5 px-1 py-3 text-center transition-transform active:scale-[0.97] motion-reduce:active:scale-100")}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/15 dark:to-sky-500/10 dark:text-indigo-300 dark:ring-indigo-400/20" aria-hidden>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-[12px] font-semibold leading-tight">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

