import { FrenzAIHistorySkeleton } from "@/features/ai/ai-skeletons";

/**
 * The Studio history page's fallback.
 *
 * Same reason as every other `loading.tsx` in this feature: without a Suspense
 * boundary a navigation blocks on the server and the tap looks ignored, which
 * is what makes people tap twice.
 */
export default function Loading() {
  return <FrenzAIHistorySkeleton />;
}
