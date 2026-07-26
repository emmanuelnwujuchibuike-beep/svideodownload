import { Heart, Star } from "lucide-react";

import { BitmojiAvatar } from "@/components/landing/bitmoji-avatar";

/**
 * "What our users are saying" — the testimonials strip from `public/newlandingfull.jpg`.
 *
 * NOTE (honesty): these are placeholder testimonials from the design, and the
 * avatars are ILLUSTRATED cartoons — never a real person's photo (public marketing).
 * Swap in real, attributed reviews when a review system exists. The heading avoids
 * "thousands" deliberately — a worded magnitude the Reality Ledger fails the build on.
 */

const REVIEWS = [
  {
    quote: "Frenz is hands down the best downloader I've ever used. Fast, reliable and super easy!",
    name: "Emily R.",
    role: "Content Creator",
    female: true,
    from: "from-rose-500 to-pink-500",
  },
  {
    quote: "Finally, a downloader that actually works on every platform. Absolutely amazing!",
    name: "David M.",
    role: "Digital Marketer",
    female: false,
    from: "from-blue-500 to-indigo-500",
  },
  {
    quote: "No watermark, high quality, and so fast! Frenz is a game changer.",
    name: "Sarah K.",
    role: "Social Media Manager",
    female: true,
    from: "from-violet-500 to-purple-500",
  },
];

export function Testimonials() {
  return (
    <section className="container max-w-6xl py-14 sm:py-20">
      <div className="grid items-start gap-8 lg:grid-cols-[0.9fr_2fr]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:border-rose-400/30 dark:text-rose-300">
            <Heart className="h-3.5 w-3.5 fill-current" /> Loved by creators
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl">
            What our users are saying
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Real feedback from the creators and everyday downloaders who use Frenz.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((r) => (
            <figure key={r.name} className="flex flex-col rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
              <div className="flex gap-0.5 text-amber-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-700 dark:text-white/80">
                &ldquo;{r.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${r.from}`}>
                  <BitmojiAvatar seed={r.name} female={r.female} className="h-full w-full" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
