import { LoadingStripe } from "@/features/ui/page-loader";

/**
 * The /downloads cold-entry skeleton (owner, 2026-08-10).
 *
 * "Make the PWA open faster on cold entry, to avoid too much white screen,
 *  especially when a user is landing on the download page."
 *
 * ── What was actually on screen before this ──────────────────────────────────
 *
 * `app/(app)/downloads/loading.tsx` re-exported the shared `PageLoader`, which
 * is a 2px animated stripe and nothing else. That is the right fallback for an
 * in-app navigation, where the previous page is still painted underneath and the
 * stripe is simply progress — but on a COLD entry there is no previous page.
 * There is an empty document, so the visitor gets a white screen with a hairline
 * on it for the whole of the server render: `auth.getUser()` plus a profile, a
 * wallpaper list and a settings read.
 *
 * That is the "too much white screen", and it is worst exactly where it was
 * reported: /downloads is `force-dynamic` and behind a sign-in redirect, so it
 * can never be served from the CDN the way the landing is.
 *
 * ── Why a shaped skeleton and not a spinner ─────────────────────────────────
 *
 * A spinner says "wait". A skeleton in the shape of the page says "your page is
 * this, and it is nearly here" — the screen has structure from the first frame,
 * and when the real content lands nothing jumps, because the blocks are already
 * the right size in the right places. That last part matters on this route:
 * substituting a differently-shaped fallback is how a loading state buys a fast
 * first paint and pays for it in layout shift.
 *
 * So the order below mirrors the real page exactly — hero, paste card, wallpaper
 * tile, stat tiles, list — at the same heights.
 *
 * ── It costs nothing ────────────────────────────────────────────────────────
 *
 * A plain server component: no "use client", no client JS, no images, no fonts
 * beyond the ones already loading. The shimmer is one CSS animation shared by
 * every block, and it is suppressed under `prefers-reduced-motion` by the global
 * rule in globals.css.
 */

/** One shimmering block. `rounded` and size come from the caller. */
function Bone({ className }: { className: string }) {
  return <div className={`animate-pulse bg-muted/60 ${className}`} />;
}

export function DownloadsSkeleton() {
  return (
    <div className="space-y-5 pt-1" role="status" aria-label="Loading your downloads">
      {/*
        🔴 THE STRIPE WAS MISSING HERE (owner, 2026-08-11: "i didnt see the
        loader in cold entry").

        This is the surface a PWA cold launch actually lands on — `start_url` is
        /home and Downloader mode, the default, serves this page there — so it is
        the one place the loader had to appear and the one place it did not. The
        shaped skeleton replaced `PageLoader` wholesale when it was added, and
        `PageLoader` WAS the stripe. Structure arrived; the thing that says "this
        is loading, not broken" did not.

        Both, now. The stripe is the shared `LoadingStripe`, so a cold entry here
        is indistinguishable from an in-app navigation to any other route.
      */}
      <div className="-mx-3 -mt-1 sm:-mx-4">
        <LoadingStripe />
      </div>

      {/* Hero — title + subtitle */}
      <div className="space-y-2 px-1">
        <Bone className="h-7 w-44 rounded-lg" />
        <Bone className="h-4 w-64 rounded-md" />
      </div>

      {/* The paste card. The reason this page exists, so it is the one block
          drawn in full detail — field, button, and the platform strip under it. */}
      <section className="rounded-3xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
        <Bone className="h-4 w-28 rounded-md" />
        <div className="mt-3 flex items-center gap-2">
          <Bone className="h-14 flex-1 rounded-xl" />
          <Bone className="h-14 w-28 rounded-xl" />
        </div>
        <Bone className="mt-4 h-3 w-32 rounded" />
        {/* Eight platform tiles, same 8-column grid as the real strip. */}
        <div className="mt-2 grid w-full max-w-md grid-cols-8 gap-1.5 sm:gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Bone key={i} className="aspect-square w-full rounded-[26%]" />
          ))}
        </div>
      </section>

      {/* Wallpaper tile — matches WallpaperCta's row height. */}
      <Bone className="h-[4.75rem] w-full rounded-2xl" />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-20 rounded-2xl" />
        ))}
      </div>

      {/* Recent downloads list */}
      <div className="space-y-3">
        <Bone className="h-5 w-36 rounded-md" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3">
            <Bone className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bone className="h-4 w-3/4 rounded" />
              <Bone className="h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
