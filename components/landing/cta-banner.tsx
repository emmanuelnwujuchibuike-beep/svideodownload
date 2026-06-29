import { ArrowRight } from "lucide-react";
import Link from "next/link";

/** Closing CTA — join the platform. */
export function CtaBanner() {
  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600 p-8 sm:p-12">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-[-0.02em] text-white sm:text-3xl">
              Join millions using FrenzSave
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/80">
              Download videos, discover what&apos;s trending, meet new friends and chat — all in one place.
            </p>
          </div>
          <Link
            href="/login?signup=1"
            className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-white/90 active:scale-[0.99]"
          >
            Get started now <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
