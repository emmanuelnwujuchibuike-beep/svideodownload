import { Quote, Star } from "lucide-react";

const TESTIMONIALS = [
  { name: "Alex J.", quote: "FrenzSave is my daily go-to app — download, watch and chat all in one place." },
  { name: "Priya S.", quote: "I download, watch trending reels and meet new people. Love it." },
  { name: "David L.", quote: "Best app to stay updated and discover what's hot." },
  { name: "Samantha K.", quote: "Fast, easy and super convenient. Highly recommend." },
];

/** Social proof — "Loved by millions". */
export function Testimonials() {
  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Loved by millions</h2>
        <p className="mt-2 text-sm text-muted-foreground">See what our community is saying.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TESTIMONIALS.map((t) => (
          <figure key={t.name} className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
            <Quote className="h-5 w-5 text-primary/40" aria-hidden />
            <blockquote className="mt-3 text-sm leading-relaxed text-foreground">{t.quote}</blockquote>
            <figcaption className="mt-4 flex items-center justify-between">
              <span className="text-sm font-semibold">{t.name}</span>
              <span className="flex gap-0.5" aria-label="5 out of 5 stars">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                ))}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
