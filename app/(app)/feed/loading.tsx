// Loading UI = a stripe under the persistent (app) top bar. Just the
// Suspense fallback — see features/ui/page-loader.tsx; touches no navigation.
// Mirrors app/(app)/home/loading.tsx — /feed had no route-level Suspense
// boundary of its own, only the inline one inside page.tsx, so a navigation
// here had nothing prefetchable to swap to instantly and had to wait on the
// dynamic RSC response before painting anything at all (owner, 2026-08-18:
// "i want the feed page start loading immediately... just like the history
// page"). /history is fully static so it has no such gap; /feed can't be
// static (it's a live, personalized, per-viewer feed) but this closes the
// same class of gap /home already had fixed.
export { default } from "@/features/ui/page-loader";
