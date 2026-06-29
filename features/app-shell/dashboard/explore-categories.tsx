import Link from "next/link";

const CATS = [
  { label: "For You", emoji: "✨", href: "/explore", tint: "from-blue-500 to-violet-600" },
  { label: "Funny", emoji: "😂", href: "/explore?category=comedy", tint: "from-amber-400 to-orange-500" },
  { label: "Music", emoji: "🎵", href: "/explore?category=music", tint: "from-violet-500 to-purple-600" },
  { label: "Sports", emoji: "⚽", href: "/explore?category=sports", tint: "from-emerald-500 to-teal-600" },
  { label: "Gaming", emoji: "🎮", href: "/explore?category=gaming", tint: "from-rose-500 to-pink-600" },
  { label: "Travel", emoji: "✈️", href: "/explore?category=travel", tint: "from-sky-500 to-blue-600" },
  { label: "Tech", emoji: "📱", href: "/explore?category=tech", tint: "from-indigo-500 to-blue-600" },
  { label: "Fashion", emoji: "👗", href: "/explore?category=beauty", tint: "from-pink-500 to-rose-600" },
];

/** Explore Categories — quick jump into the discovery feed by topic. */
export function ExploreCategories() {
  return (
    <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold">🧭 Explore Categories</h2>
        <Link href="/explore" className="text-xs font-semibold text-primary hover:underline">View all</Link>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATS.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="flex shrink-0 flex-col items-center gap-1.5 rounded-xl px-3 py-2 transition hover:bg-secondary"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${c.tint} text-xl shadow-sm`}>
              {c.emoji}
            </span>
            <span className="text-[11px] font-medium">{c.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
