import { PageLoaderWithHeader } from "@/features/ui/page-loader";

// Post section has no persistent shell header, so the loader draws the header at
// all sizes + the stripe. Suspense fallback only — touches no navigation.
export default function Loading() {
  return <PageLoaderWithHeader desktop />;
}
