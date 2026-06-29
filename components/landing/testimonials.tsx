import { Play } from "lucide-react";

const TESTIMONIALS = [
  { name: "Alex J.", quote: "FrenzSave is my daily go-to app!", duration: "0:32", gradient: "from-blue-500 to-indigo-600" },
  { name: "Priya S.", quote: "I download, watch and chat all in one place.", duration: "0:28", gradient: "from-rose-500 to-pink-600" },
  { name: "David L.", quote: "Best app to stay updated and meet new friends.", duration: "0:31", gradient: "from-violet-500 to-purple-600" },
  { name: "Samantha K.", quote: "Fast, easy and super convenient!", duration: "0:27", gradient: "from-emerald-500 to-teal-600" },
] as const;

/** Social proof — "Loved by Millions". */
export function Testimonials() {
  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <div className="mb-7 text-center">
        <h2 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Loved by Millions</h2>
        <p className="mt-2 text-sm text-muted-foreground">See what our community is saying.</p>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TESTIMONIALS.map((t) => (
          <figure key={t.name}>
            <div className={`relative aspect-[5/4] overflow-hidden rounded-2xl bg-gradient-to-br ${t.gradient} shadow-soft`}>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/25 backdrop-blur">
                  <Play className="h-5 w-5 fill-white text-white" />
                </span>
              </span>
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                <Play className="h-2.5 w-2.5 fill-white" /> {t.duration}
              </span>
            </div>
            <figcaption className="mt-3 text-center">
              <span className="block text-sm font-bold">{t.name}</span>
              <blockquote className="mt-0.5 text-xs leading-relaxed text-muted-foreground">&ldquo;{t.quote}&rdquo;</blockquote>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
