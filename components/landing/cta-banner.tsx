import { ArrowDown, Rocket } from "lucide-react";
import Link from "next/link";

/**
 * Closing CTA — "Ready to get started?" per `public/newlandingfull.jpg`, with the
 * rocket and the "free forever" reassurance.
 *
 * The subtitle deliberately avoids the reference's "Join thousands…": a worded
 * magnitude the Reality Ledger fails the build on and a crowd we cannot source.
 */
export function CtaBanner() {
  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600 p-8 shadow-elevated ring-1 ring-inset ring-white/15 sm:p-12">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-fuchsia-300/20 blur-3xl" aria-hidden />
        <Rocket aria-hidden className="pointer-events-none absolute -right-6 bottom-2 h-40 w-40 rotate-12 text-white/10" />
        <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
                <Rocket className="h-5 w-5" />
              </span>
              <h2 className="text-2xl font-bold tracking-[-0.02em] text-white sm:text-3xl">
                Ready to get started?
              </h2>
            </div>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/80">
              Download videos, discover what&apos;s trending, meet new friends and share
              your own content — all in one place.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <Link
              href="/#download"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-white/90 active:scale-[0.99]"
            >
              Start Downloading Now <ArrowDown className="h-4 w-4" />
            </Link>
            <span className="text-xs text-white/70">It&rsquo;s free forever. No credit card needed.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
