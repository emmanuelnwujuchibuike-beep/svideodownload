import { ChevronRight, Compass, DollarSign, MessageCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * "More to Explore" — three small doors under the Frenz AI / Wallpapers pair, on the
 * landing and on /downloads (owner mockup, 2026-10-16: "this is the clear design").
 * It replaces the full-width Explore Features bar; "See all" keeps /features one tap
 * away. Plain links and lucide glyphs: no state, no data, nothing added to first paint
 * beyond the markup.
 */
const ITEMS: { href: string; title: string; desc: string; icon: LucideIcon; tint: string }[] = [
  { href: "/home", title: "Post & Chat", desc: "Share and connect", icon: MessageCircle, tint: "from-rose-400 to-pink-500" },
  { href: "/quests", title: "Earn", desc: "Turn activity into rewards", icon: DollarSign, tint: "from-amber-400 to-orange-500" },
  { href: "/explore", title: "Explore", desc: "Discover trending content", icon: Compass, tint: "from-violet-500 to-indigo-600" },
];

export function MoreToExplore() {
  return (
    <section aria-labelledby="more-to-explore" className="mt-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 id="more-to-explore" className="text-[15px] font-bold tracking-tight">More to Explore</h2>
        <Link href="/features" prefetch={false} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-muted-foreground">
          See all <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {ITEMS.map(({ href, title, desc, icon: Icon, tint }) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            className="flex min-w-0 items-center gap-1.5 rounded-2xl bg-white px-1.5 py-2 shadow-[0_6px_18px_-10px_rgba(15,23,42,0.28)] ring-1 ring-inset ring-slate-900/[0.04] transition-transform active:scale-[0.97] dark:bg-white/[0.06] dark:ring-white/10 motion-reduce:transition-none"
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${tint}`}>
              <Icon className="h-4 w-4" strokeWidth={2.3} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-[11px] font-bold leading-tight">{title}</span>
              <span className="mt-0.5 block text-[9px] leading-[1.2] text-muted-foreground">{desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
