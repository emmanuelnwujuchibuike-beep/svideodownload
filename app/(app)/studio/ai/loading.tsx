import { FrenzAIPageSkeleton } from "@/features/ai/ai-skeletons";

/**
 * The Frenz AI hub's Suspense fallback — the page's own shape, not the shared
 * loading stripe. This route is one server round trip away from being instant,
 * so what a person sees for that moment should be the layout they are about to
 * get, in the same place.
 */
export default function Loading() {
  return <FrenzAIPageSkeleton />;
}
