"use client";

import { ArrowRight, Clock, Sparkles } from "lucide-react";
import Link from "next/link";

import { usePersonalItems } from "@/features/personal/use-personal";
import { recommendNext } from "@/lib/academy/recommend";
import { completedLessonSlugs } from "@/lib/personal/items";
import { cn } from "@/lib/utils";

/**
 * "Continue learning" — the personal plane's payoff.
 *
 * ── A client island, for the usual reason ─────────────────────────────────────
 *
 * `/learn` and `/academy` are statically prerendered. The ranking itself is pure
 * and could run anywhere, but the INPUT is the reader's completed lessons, which
 * live behind a `no-store` endpoint. Reading that during render would un-static
 * the campus. So the page stays anonymous and cacheable and this panel resolves
 * after paint.
 *
 * ── Signed out, it shows the same thing ───────────────────────────────────────
 *
 * With no history the ranking returns its "start here" branch, which is real,
 * useful content rather than a placeholder — so an anonymous visitor gets a
 * genuine reading order instead of an empty box or a login wall. The heading
 * changes, because calling it "Continue learning" when nothing was started
 * would be a small lie.
 */
export function RecommendedNext({ className, limit = 3 }: { className?: string; limit?: number }) {
  const items = usePersonalItems();
  const completed = completedLessonSlugs(items);
  const recs = recommendNext(completed, limit);

  if (recs.length === 0) return null;

  const returning = completed.size > 0;

  return (
    <section className={cn("rounded-2xl border border-border/70 bg-card p-6", className)}>
      <header className="mb-5 flex items-start gap-3">
        <Sparkles aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.01em]">
            {returning ? "Continue learning" : "Where to start"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {returning
              ? "Picked from what you have already finished."
              : "A reading order that builds on itself."}
          </p>
        </div>
      </header>

      <ul className="space-y-3">
        {recs.map((rec) => (
          <li key={rec.lessonSlug}>
            <Link
              href={rec.href}
              className="group flex items-start justify-between gap-4 rounded-xl border border-border/60 p-4 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="min-w-0">
                <span className="block font-medium group-hover:text-primary">{rec.title}</span>
                {/* The reason is shown, never implied. A recommendation with no
                    stated basis is treated as a random link, because it is
                    indistinguishable from one. */}
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  {rec.explanation}
                </span>
                <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock aria-hidden className="h-3.5 w-3.5" />
                  {rec.minutes} min read
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
