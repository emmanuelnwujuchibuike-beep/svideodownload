import { DownloadsSkeleton } from "@/features/downloads/downloads-skeleton";

/**
 * 🔴 /downloads gets a SHAPED skeleton, not the shared 2px stripe (owner,
 * 2026-08-10: "avoid too much white screen, especially when a user is landing on
 * the download page").
 *
 * The shared `PageLoader` is right for an in-app navigation — the previous page
 * is still painted underneath, so a progress stripe is all that is needed. On a
 * COLD entry there is nothing underneath: the visitor gets a white document with
 * a hairline on it until `auth.getUser()` and three DB reads finish.
 *
 * This route is the worst place for that. It is `force-dynamic` and behind a
 * sign-in redirect, so unlike the landing it can never be served from the CDN —
 * every cold entry pays the full origin round trip, and PWA launches land here.
 *
 * `loading.tsx` is Next's Suspense fallback and is completely isolated from
 * prefetch, `<Link>` and the page-transition system, so changing what it renders
 * cannot affect instant navigation — the same reasoning already recorded on
 * PageLoader, and the reason this is safe to make richer.
 */
export default function Loading() {
  return <DownloadsSkeleton />;
}
