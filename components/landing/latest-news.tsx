import { Newspaper, Play } from "lucide-react";
import Link from "next/link";

const NEWS = [
  { title: "Technology", sub: "The latest in AI and tech", gradient: "from-cyan-500 to-blue-600" },
  { title: "Sports", sub: "Top matches & results", gradient: "from-emerald-500 to-green-600" },
  { title: "Entertainment", sub: "Celebs, movies & more", gradient: "from-rose-500 to-pink-600" },
  { title: "Business", sub: "Markets & economy", gradient: "from-amber-500 to-orange-600" },
  { title: "Science", sub: "Discoveries & research", gradient: "from-indigo-500 to-violet-600" },
  { title: "Politics", sub: "Global political updates", gradient: "from-slate-500 to-slate-700" },
] as const;

/** Landing "Latest News" — category cards linking into the blog. */
export function LatestNews() {
  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
            <Newspaper className="h-6 w-6 shrink-0 text-cyan-500 sm:h-7 sm:w-7" aria-hidden />
            Latest News
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Stay updated with what&apos;s happening around the world.</p>
        </div>
        <Link href="/blog" className="text-sm font-semibold text-primary hover:underline">
          View All News
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {NEWS.map((n) => (
          <Link
            key={n.title}
            href="/blog"
            className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition hover:-translate-y-1 hover:shadow-card"
          >
            <div className={`relative aspect-video bg-gradient-to-br ${n.gradient}`}>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 backdrop-blur transition group-hover:bg-white/40">
                  <Play className="h-4 w-4 fill-white text-white" />
                </span>
              </span>
            </div>
            <div className="p-3">
              <h3 className="text-sm font-bold leading-tight">{n.title}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{n.sub}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
