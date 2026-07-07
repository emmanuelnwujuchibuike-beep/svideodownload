import { Compass, Gamepad2, Laugh, Music, Plane, Shirt, Smartphone, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";

const CATS = [
  { label: "For You", Icon: Sparkles, href: "/explore", tint: "from-blue-500 to-violet-600" },
  { label: "Funny", Icon: Laugh, href: "/explore?category=comedy", tint: "from-amber-400 to-orange-500" },
  { label: "Music", Icon: Music, href: "/explore?category=music", tint: "from-violet-500 to-purple-600" },
  { label: "Sports", Icon: Trophy, href: "/explore?category=sports", tint: "from-emerald-500 to-teal-600" },
  { label: "Gaming", Icon: Gamepad2, href: "/explore?category=gaming", tint: "from-rose-500 to-pink-600" },
  { label: "Travel", Icon: Plane, href: "/explore?category=travel", tint: "from-sky-500 to-blue-600" },
  { label: "Tech", Icon: Smartphone, href: "/explore?category=tech", tint: "from-indigo-500 to-blue-600" },
  { label: "Fashion", Icon: Shirt, href: "/explore?category=beauty", tint: "from-pink-500 to-rose-600" },
];

/** Explore Categories — quick jump into the discovery feed by topic. */
export function ExploreCategories() {
  return (
    <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold"><Compass className="h-4 w-4 text-primary" /> Explore Categories</h2>
        <Link href="/explore" className="text-xs font-semibold text-primary hover:underline">View all</Link>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATS.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="flex shrink-0 flex-col items-center gap-1.5 rounded-xl px-3 py-2 transition hover:bg-secondary"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${c.tint} shadow-sm`}>
              <c.Icon className="h-5 w-5 text-white" />
            </span>
            <span className="text-[11px] font-medium">{c.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
