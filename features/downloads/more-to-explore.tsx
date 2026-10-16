import { Compass, DollarSign, MessageCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * "More to Explore" — the landing's row of three small doors under the Frenz AI /
 * Wallpapers pair (owner mockup, 2026-10-16). It replaces the full-width Explore
 * Features bar there; "See all" keeps /features one tap away. Plain links and three
 * lucide glyphs: no state, no data, nothing added to first paint beyond the markup.
 * Earn lives here now that the landing's bottom nav gives its tab to Add friend.
 */
const ITEMS: { href: string; title: string; desc: string; icon: LucideIcon; tint: string }[] = [
  { href: "/home", title: "Post & Chat", desc: "Share and connect", icon: MessageCircle, tint: "from-rose-400 to-pink-500" },
  { href: "/quests", title: "Earn", desc: "Turn activity into rewards", icon: DollarSign, tint: "from-amber-400 to-orange-500" },
  { href: "/explore", title: "Explore", desc: "Discover trending content", icon: Compass, tint: "from-violet-500 to-indigo-500" },
];

export function MoreToExplore() {
  return (
    <section aria-labelledby="more-to-explore" className="mt-4">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <h2 id="more-to-explore" className="text-[13px] font-bold">More to Explore</h2>
        <Link href="/features" prefetch={false} className="text-[11.5px] font-medium text-muted-foreground">
          See all ›
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ITEMS.map(({ href, title, desc, icon: Icon, tint }) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            className="flex min-w-0 items-center gap-1.5 rounded-2xl bg-white p-1.5 ring-1 ring-inset ring-slate-900/[0.07] transition-transform active:scale-[0.97] dark:bg-white/[0.06] dark:ring-white/10 motion-reduce:transition-none"
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white ${tint}`}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold leading-tight">{title}</span>
              <span className="line-clamp-2 text-[9.5px] leading-tight text-muted-foreground">{desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
