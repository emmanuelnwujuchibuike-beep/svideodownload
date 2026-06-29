import { Plus, Users } from "lucide-react";
import Link from "next/link";

import { formatCompactNumber } from "@/lib/utils";

// Representative communities — a communities backend isn't modelled yet.
const COMMUNITIES = [
  { name: "Photography Club", members: 12_400, emoji: "📷", gradient: "from-rose-500 to-pink-600" },
  { name: "Music Lovers", members: 8_700, emoji: "🎧", gradient: "from-violet-500 to-purple-600" },
  { name: "Football Fans", members: 15_800, emoji: "⚽", gradient: "from-emerald-500 to-teal-600" },
  { name: "Travel World", members: 9_300, emoji: "✈️", gradient: "from-sky-500 to-blue-600" },
];

/** Join Communities — discover groups around shared interests. */
export function JoinCommunities() {
  return (
    <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold"><Users className="h-4 w-4 text-primary" /> Join Communities</h2>
        <Link href="/explore" className="text-xs font-semibold text-primary hover:underline">View all</Link>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Discover, share and connect with people who love the same things.</p>

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {COMMUNITIES.map((c) => (
          <div key={c.name} className="w-40 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-background">
            <div className={`flex h-20 items-center justify-center bg-gradient-to-br ${c.gradient} text-3xl`}>{c.emoji}</div>
            <div className="p-2.5">
              <p className="truncate text-sm font-semibold">{c.name}</p>
              <p className="text-[11px] text-muted-foreground">{formatCompactNumber(c.members)} members</p>
              <button type="button" className="mt-2 w-full rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 py-1.5 text-xs font-semibold text-white transition hover:opacity-95">
                Join
              </button>
            </div>
          </div>
        ))}
        <Link href="/explore" className="flex w-40 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background text-muted-foreground transition hover:border-foreground/20 hover:text-foreground">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary"><Plus className="h-5 w-5" /></span>
          <span className="text-xs font-semibold">Create Space</span>
        </Link>
      </div>
    </section>
  );
}
