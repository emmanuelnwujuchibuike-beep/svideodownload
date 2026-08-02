import { PageLoaderWithHeader } from "@/features/ui/page-loader";

// Profile section: the mobile top bar lives in the page, so the loader draws a
// matching mobile header (desktop has the persistent shell bar) + the stripe.
// Suspense fallback only — touches no navigation. See page-loader.tsx.
export default function Loading() {
  return <PageLoaderWithHeader />;
}
