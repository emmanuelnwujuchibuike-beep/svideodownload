import { FrenzWordmark } from "@/components/brand/frenz-logo";

/**
 * PageLoader — the loading UI shown ONLY inside a route's `loading.tsx` (Next's
 * Suspense fallback), in place of the old skeletons.
 *
 * ── Why this is safe (owner, 2026-08) ─────────────────────────────────────────
 * `loading.tsx` is the Suspense fallback Next shows while a route's own data
 * resolves. It is completely isolated from prefetch, caching, `<Link>` and the
 * page-transition system — changing what it renders CANNOT affect instant
 * navigation. This component adds NOTHING global: no root-layout mount, no
 * `history` patching, no MutationObserver, no navigation hooks. It's a plain
 * server component (no "use client"), so it ships no client JS either. See
 * [[feedback-never-add-global-runtime-that-touches-navigation]].
 *
 * The loader is a top header + a thin animated stripe below it. On the signed-in
 * app pages the real top bar is already persistent (it lives in the (app) layout,
 * not the page), so those loading files use the default `PageLoader` — just the
 * stripe under that persistent header. Sections whose header lives in the PAGE
 * (profile /u, post /p) have no header during loading, so those use
 * `PageLoaderWithHeader`, which draws a matching bar too.
 */

/** The indeterminate stripe. Pure CSS animation (frenz-loader-bar in globals). */
function LoadingStripe() {
  return (
    <div role="status" aria-label="Loading" className="w-full overflow-hidden bg-primary/10" style={{ height: "2px" }}>
      <div className="frenz-loader-bar h-full w-2/5 bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500" />
    </div>
  );
}

/** Default: just the stripe — for pages whose top header is already persistent. */
export default function PageLoader() {
  return <LoadingStripe />;
}

/**
 * Stripe plus a matching top header bar, for sections whose header lives in the
 * page (so nothing shows it during loading). `desktop` = also show the bar at lg+
 * (post pages have no persistent shell header at all); left off, the bar is
 * mobile-only because the desktop shell header is already persistent (profile).
 */
export function PageLoaderWithHeader({ desktop = false }: { desktop?: boolean }) {
  return (
    <>
      <header className={`${desktop ? "" : "lg:hidden"} border-b border-border/40 bg-background pt-[var(--frenz-safe-top)]`}>
        <div className="flex h-14 items-center px-4">
          <FrenzWordmark size={28} textClassName="text-base" />
        </div>
      </header>
      <LoadingStripe />
    </>
  );
}
